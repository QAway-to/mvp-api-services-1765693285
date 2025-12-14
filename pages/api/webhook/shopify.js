// Shopify Webhook endpoint
import { shopifyAdapter } from '../../../src/lib/adapters/shopify/index.js';
import { callBitrix, getBitrixWebhookBase } from '../../../src/lib/bitrix/client.js';
import { mapShopifyOrderToBitrixDeal } from '../../../src/lib/bitrix/orderMapper.js';
import { upsertBitrixContact } from '../../../src/lib/bitrix/contact.js';
import { BITRIX_CONFIG, financialStatusToStageId, financialStatusToPaymentStatus } from '../../../src/lib/bitrix/config.js';

// Configure body parser to accept raw JSON
// Increased size limit for large orders with many line items
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb', // Increased from 1mb for large orders
    },
  },
};

/**
 * Determine category ID based on order tags
 * @param {Object} order - Shopify order object
 * @returns {number} Category ID (2 = Stock, 8 = Pre-order)
 */
function determineCategoryId(order) {
  const orderTags = Array.isArray(order.tags) 
    ? order.tags 
    : (order.tags ? String(order.tags).split(',').map(t => t.trim()) : []);
  
  const preorderTags = ['pre-order', 'preorder-product-added'];
  const hasPreorderTag = orderTags.some(tag => 
    preorderTags.some(preorderTag => tag.toLowerCase() === preorderTag.toLowerCase())
  );
  
  return hasPreorderTag ? BITRIX_CONFIG.CATEGORY_PREORDER : BITRIX_CONFIG.CATEGORY_STOCK;
}

/**
 * Unified upsert function for deals from Shopify orders
 * This function is used by BOTH orders/create and orders/updated webhooks with IDENTICAL logic
 * 
 * @param {Object} order - Shopify order object
 * @param {string} eventType - 'orders/create' or 'orders/updated'
 * @param {string} correlationId - Correlation ID for logging (orderId:eventId)
 * @returns {Promise<Object>} { dealId, isCreated, dealFields, productRows }
 */
async function upsertDealFromOrder(order, eventType, correlationId) {
  // ✅ Normalization: Use order.id (numeric Shopify order ID), NOT eventId
  const orderId = String(order.id);
  const eventId = order.eventId || 'unknown';
  const categoryId = determineCategoryId(order);
  const email = order.email || order.customer?.email || 'N/A';
  const orderName = order.name || `Order #${order.id}`;
  const financialStatus = order.financial_status || 'unknown';
  
  // ✅ Structured logging: [WEBHOOK_RECEIVED]
  console.log(JSON.stringify({
    event: 'WEBHOOK_RECEIVED',
    correlationId,
    topic: eventType,
    eventId,
    orderId,
    orderName,
    email,
    financial_status: financialStatus,
    timestamp: new Date().toISOString()
  }));

  // Map order to Bitrix deal fields
  const { dealFields, productRows } = mapShopifyOrderToBitrixDeal(order);
  
  // ✅ ENSURE: UF_CRM_1742556489 (Shopify number) and CATEGORY_ID are set correctly
  dealFields.UF_CRM_1742556489 = orderId; // Real Bitrix field for Shopify order ID
  dealFields.CATEGORY_ID = categoryId; // Required for create, immutable after

  // Upsert contact (non-blocking)
  let contactId = null;
  try {
    const bitrixBase = getBitrixWebhookBase();
    contactId = await upsertBitrixContact(bitrixBase, order);
    if (contactId) {
      dealFields.CONTACT_ID = contactId;
    }
  } catch (contactError) {
    console.error(`[UPSERT] [${correlationId}] Contact upsert failed (non-blocking):`, contactError);
  }

  // ✅ CRITICAL: Search deal ONLY by UF_CRM_1742556489 (Shopify number) + CATEGORY_ID
  // NEVER search by email/title/customer - only by these two fields
  const filter = {
    'UF_CRM_1742556489': orderId, // Real Bitrix field (Shopify number)
    'CATEGORY_ID': categoryId, // ✅ CRITICAL: Must filter by category
  };
  
  // ✅ Structured logging: [DEAL_LOOKUP_REQUEST]
  console.log(JSON.stringify({
    event: 'DEAL_LOOKUP_REQUEST',
    correlationId,
    filter,
    timestamp: new Date().toISOString()
  }));
  
  const listResp = await callBitrix('/crm.deal.list.json', {
    filter,
    select: ['ID', 'OPPORTUNITY', 'STAGE_ID', 'CATEGORY_ID', 'DATE_CREATE', 'TITLE', 'UF_CRM_1742556489'],
    order: { 'DATE_CREATE': 'DESC' },
  });
  
  const foundDeals = listResp.result || [];
  const dealsCount = foundDeals.length;
  const dealIds = foundDeals.map(d => d.ID);
  
  // ✅ Structured logging: [DEAL_LOOKUP_RESULT]
  console.log(JSON.stringify({
    event: 'DEAL_LOOKUP_RESULT',
    correlationId,
    count: dealsCount,
    dealIds,
    timestamp: new Date().toISOString()
  }));
  
  let dealId = null;
  let isCreated = false;
  
  if (dealsCount === 0) {
    // No deal found - CREATE NEW DEAL
    // ✅ Structured logging: [DEAL_ADD_REQUEST]
    console.log(JSON.stringify({
      event: 'DEAL_ADD_REQUEST',
      correlationId,
      orderId,
      categoryId,
      bitrixKeyField: 'UF_CRM_1742556489',
      bitrixKeyValue: orderId,
      fields: Object.keys(dealFields),
      timestamp: new Date().toISOString()
    }));
    
  const dealAddResp = await callBitrix('/crm.deal.add.json', {
    fields: dealFields,
  });

    // ✅ Structured logging: [DEAL_ADD_RESULT]
    console.log(JSON.stringify({
      event: 'DEAL_ADD_RESULT',
      correlationId,
      success: !!dealAddResp.result,
      dealId: dealAddResp.result || null,
      response: dealAddResp,
      timestamp: new Date().toISOString()
    }));

  if (!dealAddResp.result) {
    throw new Error(`Failed to create deal: ${JSON.stringify(dealAddResp)}`);
  }

    // ✅ dealId MUST come from crm.deal.add response
    dealId = dealAddResp.result;
    isCreated = true;
    
  } else if (dealsCount === 1) {
    // Exactly one deal found - UPDATE IT
    const existingDeal = foundDeals[0];
    dealId = existingDeal.ID;
    isCreated = false;
    
    // ✅ CRITICAL: CATEGORY_ID is immutable after creation - remove it from update fields
    const updateFields = { ...dealFields };
    delete updateFields.CATEGORY_ID; // Don't update CATEGORY_ID (immutable)
    
    // ✅ Structured logging: [DEAL_UPDATE_REQUEST]
    console.log(JSON.stringify({
      event: 'DEAL_UPDATE_REQUEST',
      correlationId,
      dealId,
      dealIdSource: 'list',
      orderId,
      categoryId: existingDeal.CATEGORY_ID,
      bitrixKeyField: 'UF_CRM_1742556489',
      bitrixKeyValue: orderId,
      fields: Object.keys(updateFields),
      timestamp: new Date().toISOString()
    }));
    
    const updateResp = await callBitrix('/crm.deal.update.json', {
        id: dealId,
      fields: updateFields,
      });
    
    // ✅ Structured logging: [DEAL_UPDATE_RESULT]
    console.log(JSON.stringify({
      event: 'DEAL_UPDATE_RESULT',
      correlationId,
      dealId,
      success: updateResp.result !== undefined && updateResp.result !== false,
      response: updateResp,
      timestamp: new Date().toISOString()
    }));
    
  } else {
    // Multiple deals found - CRITICAL ERROR
    const dealIds = foundDeals.map(d => d.ID);
    // ✅ Structured logging: [DEAL_LOOKUP_RESULT] already logged above with count > 1
    console.log(JSON.stringify({
      event: 'CRITICAL_ERROR',
      correlationId,
      error: 'duplicate_deals',
      message: `Found ${dealsCount} deals for orderId="${orderId}" in category ${categoryId}`,
      dealIds,
      timestamp: new Date().toISOString()
    }));
    
    throw new Error(`CRITICAL: Duplicate deals found for orderId="${orderId}" in category ${categoryId}. Deal IDs: ${dealIds.join(', ')}. This indicates data corruption or missing unique constraint. Stopping to prevent random updates.`);
  }
  
  // ✅ CRITICAL SAFETY CHECK: Verify deal has correct UF_CRM_1742556489 before proceeding
  const verifyResp = await callBitrix('/crm.deal.get.json', {
    id: dealId,
  });

  const verifiedDeal = verifyResp.result;
  const verifiedOrderId = verifiedDeal?.UF_CRM_1742556489; // Real Bitrix field
  const verifiedCategoryId = verifiedDeal?.CATEGORY_ID;
  const verifiedStageId = verifiedDeal?.STAGE_ID;
  
  // ✅ Structured logging: [DEAL_SAFETY_CHECK]
  console.log(JSON.stringify({
    event: 'DEAL_SAFETY_CHECK',
    correlationId,
    dealId,
    dealIdSource: isCreated ? 'add' : 'list',
    orderId,
    verifiedOrderId,
    verifiedCategoryId,
    verifiedStageId,
    bitrixKeyField: 'UF_CRM_1742556489',
    bitrixKeyValue: verifiedOrderId,
    match: String(verifiedOrderId) === String(orderId),
    timestamp: new Date().toISOString()
  }));

  // ✅ Fail-fast if wrong deal
  if (String(verifiedOrderId) !== String(orderId)) {
    const error = {
      event: 'CRITICAL_ERROR',
      correlationId,
      error: 'wrong_deal',
      message: `Deal ${dealId} has wrong UF_CRM_1742556489`,
      expected: orderId,
      actual: verifiedOrderId,
      dealId,
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(error));
    throw new Error(`Deal ${dealId} has wrong UF_CRM_1742556489: expected "${orderId}", got "${verifiedOrderId}". This deal might be for a different order! ABORTING product rows set.`);
  }

  // Check if UF_CRM_1742556489 field exists (not undefined/null)
  if (verifiedOrderId === undefined || verifiedOrderId === null) {
    const error = {
      event: 'CRITICAL_ERROR',
      correlationId,
      error: 'missing_key_field',
      message: `Deal ${dealId} has NO UF_CRM_1742556489 field`,
      dealId,
      categoryId: verifiedCategoryId,
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(error));
    throw new Error(`Deal ${dealId} has no UF_CRM_1742556489 field. Check if UF field exists in category ${verifiedCategoryId}.`);
  }
  
  return { dealId, isCreated, dealFields, productRows };
}

/**
 * Set product rows for a deal with verification
 * @param {string} dealId - Deal ID
 * @param {Array} productRows - Product rows array
 * @param {string} orderId - Shopify order ID for verification
 * @param {string} correlationId - Correlation ID for logging
 */
async function setProductRowsWithVerification(dealId, productRows, orderId, correlationId) {
  try {
    // ✅ CRITICAL: Verify deal one more time before setting product rows (using real Bitrix field)
    const preCheckResp = await callBitrix('/crm.deal.get.json', {
      id: dealId,
    });
    const preCheckDeal = preCheckResp.result;
    const preCheckOrderId = preCheckDeal?.UF_CRM_1742556489; // Real Bitrix field
    
    if (String(preCheckOrderId) !== String(orderId)) {
      const error = {
        event: 'CRITICAL_ERROR',
        correlationId,
        error: 'productrows_precheck_failed',
        message: `Deal ${dealId} has wrong UF_CRM_1742556489 before product rows set`,
        expected: orderId,
        actual: preCheckOrderId,
        dealId,
        timestamp: new Date().toISOString()
      };
      console.log(JSON.stringify(error));
      throw new Error(`Pre-check failed: Deal ${dealId} has wrong UF_CRM_1742556489. Expected "${orderId}", got "${preCheckOrderId}". Aborting to prevent data corruption.`);
    }
    
    // Strategy: Clear all rows first, then set new rows (ensures complete replacement)
    if (!productRows || productRows.length === 0) {
      // ✅ Structured logging: [PRODUCTROWS_SET_REQUEST]
      console.log(JSON.stringify({
        event: 'PRODUCTROWS_SET_REQUEST',
        correlationId,
        dealId,
        orderId,
        action: 'clear',
        rowsCount: 0,
        timestamp: new Date().toISOString()
      }));
      
      await callBitrix('/crm.deal.productrows.set.json', {
        id: dealId,
        rows: [],
      });
      
      // ✅ Structured logging: [PRODUCTROWS_SET_RESULT]
      console.log(JSON.stringify({
        event: 'PRODUCTROWS_SET_RESULT',
        correlationId,
        dealId,
        orderId,
        success: true,
        rowsCount: 0,
        timestamp: new Date().toISOString()
      }));
    } else {
      // Step 1: Clear all existing rows
      await callBitrix('/crm.deal.productrows.set.json', {
        id: dealId,
        rows: [],
      });
      
      // Step 2: Set new rows
      // ✅ Structured logging: [PRODUCTROWS_SET_REQUEST]
      console.log(JSON.stringify({
        event: 'PRODUCTROWS_SET_REQUEST',
        correlationId,
        dealId,
        orderId,
        action: 'set',
        rowsCount: productRows.length,
        timestamp: new Date().toISOString()
      }));
      
      await callBitrix('/crm.deal.productrows.set.json', {
        id: dealId,
        rows: productRows,
      });
      
      // ✅ Structured logging: [PRODUCTROWS_SET_RESULT]
      console.log(JSON.stringify({
        event: 'PRODUCTROWS_SET_RESULT',
        correlationId,
        dealId,
        orderId,
        success: true,
        rowsCount: productRows.length,
        timestamp: new Date().toISOString()
      }));
    }
    
    // ✅ Final verification: Check that product rows were set to correct deal
    try {
      const finalVerifyResp = await callBitrix('/crm.deal.get.json', {
        id: dealId,
      });
      const finalDeal = finalVerifyResp.result;
      const finalOrderId = finalDeal?.UF_CRM_1742556489; // Real Bitrix field
      
      if (String(finalOrderId) !== String(orderId)) {
        const error = {
          event: 'CRITICAL_ERROR',
          correlationId,
          error: 'productrows_postcheck_failed',
          message: `Deal ${dealId} has wrong UF_CRM_1742556489 after product rows set`,
          expected: orderId,
          actual: finalOrderId,
          dealId,
          timestamp: new Date().toISOString()
        };
        console.log(JSON.stringify(error));
        throw new Error(`Post-verification failed: Deal ${dealId} has wrong UF_CRM_1742556489 after setting product rows`);
      }
    } catch (finalVerifyError) {
      // Log but don't throw - product rows were set, verification is just a safety check
      console.log(JSON.stringify({
        event: 'WARNING',
        correlationId,
        warning: 'productrows_final_verification_failed',
        error: finalVerifyError.message,
        timestamp: new Date().toISOString()
      }));
    }
  } catch (productRowsError) {
    console.log(JSON.stringify({
      event: 'ERROR',
      correlationId,
      error: 'productrows_set_failed',
      message: productRowsError.message,
      timestamp: new Date().toISOString()
    }));
    throw productRowsError; // Re-throw to fail-fast
  }
}

/**
 * Handle order created event - create deal in Bitrix
 * Uses unified upsertDealFromOrder function
 */
async function handleOrderCreated(order) {
  const orderId = String(order.id);
  const eventId = order.eventId || 'unknown';
  const correlationId = `${orderId}:${eventId}`;
  
  // Use unified upsert function (same logic for both create and update)
  const { dealId, isCreated, productRows } = await upsertDealFromOrder(order, 'orders/create', correlationId);
  
  // Set product rows (always, regardless of created or updated)
  await setProductRowsWithVerification(dealId, productRows, orderId, correlationId);
  
  // ✅ Structured logging: [WEBHOOK_DONE]
  console.log(JSON.stringify({
    event: 'WEBHOOK_DONE',
    correlationId,
    topic: 'orders/create',
    eventId,
    orderId,
    orderName: order.name,
    dealId,
    dealIdSource: isCreated ? 'add' : 'list',
    success: true,
    timestamp: new Date().toISOString()
  }));
  
  return dealId;
}

/**
 * Handle order updated event - update deal in Bitrix
 * Uses unified upsertDealFromOrder function
 */
async function handleOrderUpdated(order) {
  const orderId = String(order.id);
  const eventId = order.eventId || 'unknown';
  const correlationId = `${orderId}:${eventId}`;
  
  // Use unified upsert function (will create if missing, update if exists)
  const { dealId, isCreated, productRows } = await upsertDealFromOrder(order, 'orders/updated', correlationId);
  
  // Set product rows
  await setProductRowsWithVerification(dealId, productRows, orderId, correlationId);
  
  // ✅ Structured logging: [WEBHOOK_DONE]
  console.log(JSON.stringify({
    event: 'WEBHOOK_DONE',
    correlationId,
    topic: 'orders/updated',
    eventId,
    orderId,
    orderName: order.name,
    dealId,
    dealIdSource: isCreated ? 'add' : 'list',
    success: true,
    timestamp: new Date().toISOString()
  }));

  return dealId;
}

/**
 * Handle product update event
 * This only updates internal catalog, not deals
 */
async function handleProductUpdated(product) {
  console.log(`[SHOPIFY WEBHOOK] Handling product updated: ${product.id || product.title}`);
  // Product updates don't affect deals - they're for catalog synchronization only
  console.log(`[SHOPIFY WEBHOOK] Product updates don't affect deals - skipping`);
  return null;
}

// Export handler function for reuse in other endpoints
export async function handler(req, res) {
  // Enhanced logging - log ALL incoming requests immediately
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[SHOPIFY WEBHOOK] ===== INCOMING REQUEST [${requestId}] =====`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Method: ${req.method}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] URL: ${req.url}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] All headers:`, JSON.stringify(req.headers, null, 2));
  
  if (req.method !== 'POST') {
    console.log(`[SHOPIFY WEBHOOK] [${requestId}] ❌ Method not allowed: ${req.method}`);
    res.status(405).end('Method not allowed');
    return;
  }

  // Log raw body size
  const bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Body size: ${bodyString?.length || 0} bytes`);
  
  const topic = req.headers['x-shopify-topic'] || req.headers['X-Shopify-Topic'];
  const shopifyShopDomain = req.headers['x-shopify-shop-domain'] || req.headers['X-Shopify-Shop-Domain'];
  const shopifyHmac = req.headers['x-shopify-hmac-sha256'] || req.headers['X-Shopify-Hmac-Sha256'];
  
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Topic: ${topic || 'MISSING!'}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Shop Domain: ${shopifyShopDomain || 'MISSING!'}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] HMAC Present: ${!!shopifyHmac}`);
  
  const order = req.body;

  // Try to extract order info even if structure is different
  const orderId = order?.id || order?.order_id || order?.order?.id || 'N/A';
  const orderName = order?.name || order?.order_name || order?.order?.name || 'N/A';
  
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Order ID: ${orderId}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Order Name: ${orderName}`);
  console.log(`[SHOPIFY WEBHOOK] [${requestId}] Body keys: ${Object.keys(order || {}).join(', ')}`);

  // If no topic, log full body for debugging
  if (!topic) {
    console.error(`[SHOPIFY WEBHOOK] [${requestId}] ⚠️ NO TOPIC HEADER! Full body:`, JSON.stringify(order, null, 2));
  }

  try {
    // Store event for monitoring (non-blocking)
    try {
      const storedEvent = shopifyAdapter.storeEvent(order);
      console.log(`[SHOPIFY WEBHOOK] [${requestId}] ✅ Event stored. Topic: ${topic}, Order: ${orderName || orderId}`);
    } catch (storeError) {
      console.error(`[SHOPIFY WEBHOOK] [${requestId}] ⚠️ Failed to store event:`, storeError);
    }

    // Handle different topics - SEPARATE HANDLERS
    if (topic === 'orders/create') {
      await handleOrderCreated(order);
    } else if (topic === 'orders/updated') {
      // orders/updated handles all updates including refunds and cancellations
      await handleOrderUpdated(order);
    } else if (topic === 'products/update') {
      // Product updates only affect internal catalog, not deals
      await handleProductUpdated(order);
    } else if (topic === 'refunds/create') {
      // Refunds are handled by orders/updated - this is deprecated but kept for backward compatibility
      console.log(`[SHOPIFY WEBHOOK] [${requestId}] ⚠️ refunds/create webhook received but refunds are handled by orders/updated`);
      // Optionally: fetch order and process via handleOrderUpdated
      // For now, just log and return 200
    } else {
      // For other topics just log and return 200
      console.log(`[SHOPIFY WEBHOOK] [${requestId}] Unhandled topic: ${topic || 'null/undefined'}`);
    }

    console.log(`[SHOPIFY WEBHOOK] [${requestId}] ✅ Request processed successfully`);
    res.status(200).json({ success: true, requestId, topic });
  } catch (e) {
    console.error(`[SHOPIFY WEBHOOK] [${requestId}] ❌ Error:`, e);
    console.error(`[SHOPIFY WEBHOOK] [${requestId}] Error stack:`, e.stack);
    res.status(500).json({ 
      error: 'Internal server error', 
      message: e.message,
      requestId 
    });
  }
}

// Default export for direct use
export default handler;