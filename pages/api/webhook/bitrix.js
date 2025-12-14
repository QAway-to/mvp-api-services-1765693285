// Bitrix24 Webhook endpoint - receives events from Bitrix and syncs to Shopify
import { callBitrix } from '../../../src/lib/bitrix/client.js';
import { bitrixAdapter } from '../../../src/lib/adapters/bitrix/index.js';
import { BITRIX_CONFIG } from '../../../src/lib/bitrix/config.js';
import { getFulfillmentOrders } from '../../../src/lib/shopify/fulfillment.js';
import { extractDealId, extractAuthToken, getPayloadKeys } from '../../../src/lib/bitrix/webhookParser.js';

// Expected auth token from Bitrix
const EXPECTED_AUTH_TOKEN = process.env.BITRIX_AUTH_TOKEN || '9gxukpkc7i1y4gms906jvm0t51npv0vb';

// Configure body parser - support both JSON and form-urlencoded
// Next.js automatically parses form-urlencoded when bodyParser is enabled
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
      // Next.js will parse both JSON and form-urlencoded automatically
    },
  },
};

/**
 * Handle deal update event from Bitrix
 * Checks for Delivery trigger: CATEGORY_ID == 2, STAGE_ID == "C2:EXECUTING"
 */
async function handleDealUpdate(dealId, requestId) {
  // ✅ Structured logging: [BITRIX_WEBHOOK_RECEIVED]
  console.log(JSON.stringify({
    event: 'BITRIX_WEBHOOK_RECEIVED',
    requestId,
    dealId,
    timestamp: new Date().toISOString()
  }));

  // Get full deal data from Bitrix REST API
  let dealData = null;
  try {
    const dealResp = await callBitrix('/crm.deal.get.json', {
      id: dealId,
    });

    if (!dealResp.result) {
      const error = {
        event: 'DEAL_GET_FAILED',
        requestId,
        dealId,
        error: 'Deal not found or failed to fetch',
        response: dealResp,
        timestamp: new Date().toISOString()
      };
      console.log(JSON.stringify(error));
      return { success: false, reason: 'deal_not_found' };
    }

    dealData = dealResp.result;
  } catch (error) {
    const errorLog = {
      event: 'DEAL_GET_ERROR',
      requestId,
      dealId,
      error: error.message,
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(errorLog));
    return { success: false, reason: 'deal_get_error', error: error.message };
  }

  // Extract required fields
  const categoryId = dealData.CATEGORY_ID;
  const stageId = dealData.STAGE_ID;
  const shopifyOrderId = dealData.UF_CRM_1742556489 || dealData.uf_crm_1742556489;
  const comments = dealData.COMMENTS || '';

  // ✅ Structured logging: [DEAL_DATA_RECEIVED]
  console.log(JSON.stringify({
    event: 'DEAL_DATA_RECEIVED',
    requestId,
    dealId,
    categoryId,
    stageId,
    shopifyOrderId,
    timestamp: new Date().toISOString()
  }));

  // Store event in adapter for UI display
  try {
    bitrixAdapter.storeEvent({
      dealId,
      categoryId,
      stageId,
      shopifyOrderId,
      comments,
      received_at: new Date().toISOString(),
      rawDealData: dealData
    });
  } catch (storeError) {
    console.error(`[BITRIX WEBHOOK] Failed to store event (non-blocking):`, storeError);
  }

  // Check Delivery trigger conditions
  const correlationId = `${dealId}:${shopifyOrderId || 'no-shopify-id'}`;
  const decision = {
    categoryMatch: String(categoryId) === String(BITRIX_CONFIG.CATEGORY_STOCK) || String(categoryId) === '2',
    stageMatch: String(stageId) === BITRIX_CONFIG.STAGES_CAT_2.EXECUTING || String(stageId) === 'C2:EXECUTING',
    shopifyOrderIdPresent: shopifyOrderId && shopifyOrderId.trim() !== '',
  };

  // ✅ Structured logging: [DELIVERY_TRIGGER_CHECK]
  console.log(JSON.stringify({
    event: 'DELIVERY_TRIGGER_CHECK',
    requestId,
    dealId,
    correlationId,
    categoryId,
    stageId,
    shopifyOrderId,
    decision,
    expectedCategoryId: BITRIX_CONFIG.CATEGORY_STOCK,
    expectedStageId: BITRIX_CONFIG.STAGES_CAT_2.EXECUTING,
    timestamp: new Date().toISOString()
  }));

  // Check if all conditions are met
  if (decision.categoryMatch && decision.stageMatch && decision.shopifyOrderIdPresent) {
    // ✅ DELIVERY TRIGGER MATCHED
    console.log(JSON.stringify({
      event: 'DELIVERY_TRIGGER_MATCH',
      requestId,
      dealId,
      correlationId,
      categoryId,
      stageId,
      shopifyOrderId,
      timestamp: new Date().toISOString()
    }));

    // ✅ MICROSTEP A1: Read fulfillments from Shopify (DRY-RUN, no writes)
    try {
      const fulfillmentResult = await getFulfillmentOrders(shopifyOrderId);
      
      // Prepare result summary
      const resultSummary = {
        success: fulfillmentResult.success,
        count: fulfillmentResult.count,
        fulfillmentIds: fulfillmentResult.fulfillmentIds,
        hasFulfillments: fulfillmentResult.count > 0
      };

      // ✅ Structured logging: [SHOPIFY_FULFILLMENT_CHECK]
      console.log(JSON.stringify({
        event: 'SHOPIFY_FULFILLMENT_CHECK',
        requestId,
        dealId,
        correlationId,
        shopifyOrderId,
        resultSummary,
        httpStatus: fulfillmentResult.httpStatus,
        timestamp: new Date().toISOString()
      }));

      // Handle authentication errors (401/403)
      if (fulfillmentResult.error === 'SHOPIFY_ADMIN_AUTH_ERROR') {
        console.log(JSON.stringify({
          event: 'SHOPIFY_ADMIN_AUTH_ERROR',
          requestId,
          dealId,
          correlationId,
          shopifyOrderId,
          httpStatus: fulfillmentResult.httpStatus,
          message: fulfillmentResult.message,
          timestamp: new Date().toISOString()
        }));
      }
    } catch (fulfillmentError) {
      // Log any unexpected errors during fulfillment check
      console.log(JSON.stringify({
        event: 'SHOPIFY_FULFILLMENT_CHECK_ERROR',
        requestId,
        dealId,
        correlationId,
        shopifyOrderId,
        error: fulfillmentError.message,
        stack: fulfillmentError.stack,
        timestamp: new Date().toISOString()
      }));
    }

    return { success: true, triggerMatch: true, correlationId };
  } else {
    // Conditions not met - log skip reason
    const skipReasons = [];
    if (!decision.categoryMatch) {
      skipReasons.push(`categoryId=${categoryId} != ${BITRIX_CONFIG.CATEGORY_STOCK}`);
    }
    if (!decision.stageMatch) {
      skipReasons.push(`stageId=${stageId} != ${BITRIX_CONFIG.STAGES_CAT_2.EXECUTING}`);
    }
    if (!decision.shopifyOrderIdPresent) {
      skipReasons.push('shopifyOrderId is missing or empty');
    }

    const skipReason = skipReasons.join('; ');

    // ✅ Structured logging: [DELIVERY_TRIGGER_SKIP]
    console.log(JSON.stringify({
      event: 'DELIVERY_TRIGGER_SKIP',
      requestId,
      dealId,
      correlationId,
      categoryId,
      stageId,
      shopifyOrderId,
      skip_reason: skipReason,
      decision,
      timestamp: new Date().toISOString()
    }));

    return { success: true, triggerMatch: false, skip_reason: skipReason };
  }
}

/**
 * Handle deal creation event from Bitrix
 * Usually not needed as deals are created from Shopify, but handle for completeness
 */
async function handleDealCreate(dealId, requestId) {
  // ✅ Structured logging: [BITRIX_WEBHOOK_RECEIVED] (CREATE)
  console.log(JSON.stringify({
    event: 'BITRIX_WEBHOOK_RECEIVED',
    requestId,
    dealId,
    eventType: 'CREATE',
    timestamp: new Date().toISOString()
  }));

  // Deals are typically created from Shopify, so this is usually a no-op
  // But we can log it for monitoring
  return { success: true, triggerMatch: false, skip_reason: 'deal_create_event_ignored' };
}

/**
 * Main webhook handler
 */
export default async function handler(req, res) {
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const contentType = req.headers['content-type'] || 'unknown';
  const body = req.body || {};
  const payloadKeys = getPayloadKeys(body);
  const authToken = extractAuthToken(body);
  const hasAuthToken = !!authToken;

  // ✅ Structured logging: [BITRIX_WEBHOOK_INCOMING]
  console.log(JSON.stringify({
    event: 'BITRIX_WEBHOOK_INCOMING',
    requestId,
    method: req.method,
    contentType,
    payloadKeys,
    hasAuthToken,
    timestamp: new Date().toISOString()
  }));
  
  if (req.method !== 'POST') {
    console.log(JSON.stringify({
      event: 'BITRIX_WEBHOOK_METHOD_NOT_ALLOWED',
      requestId,
      method: req.method,
      timestamp: new Date().toISOString()
    }));
    res.status(405).end('Method not allowed');
    return;
  }

  // Check authentication token (only if token is provided)
  if (hasAuthToken && authToken !== EXPECTED_AUTH_TOKEN) {
    console.log(JSON.stringify({
      event: 'BITRIX_WEBHOOK_AUTH_FAIL',
      requestId,
      hasAuthToken: true,
      tokenMatch: false,
      expectedToken: EXPECTED_AUTH_TOKEN.substring(0, 10) + '...',
      receivedToken: authToken.substring(0, 10) + '...',
      timestamp: new Date().toISOString()
    }));
    res.status(401).json({ error: 'Invalid authentication token' });
    return;
  }

  // Extract deal ID from payload (supports JSON and form-urlencoded)
  const { dealId, extractionPath } = extractDealId(body);

  if (!dealId) {
    // ✅ Structured logging: [BITRIX_WEBHOOK_INVALID_FORMAT]
    const errorLog = {
      event: 'BITRIX_WEBHOOK_INVALID_FORMAT',
      requestId,
      error: 'No deal ID found in payload',
      payloadKeys,
      contentType,
      timestamp: new Date().toISOString()
    };
    console.log(JSON.stringify(errorLog));
    res.status(400).json({ error: 'Invalid event format: no deal ID found', payloadKeys, contentType });
    return;
  }

  // ✅ Structured logging: [BITRIX_DEAL_ID_EXTRACTED]
  console.log(JSON.stringify({
    event: 'BITRIX_DEAL_ID_EXTRACTED',
    requestId,
    dealId,
    extractionPath,
    timestamp: new Date().toISOString()
  }));

  const event = body;
  const eventType = event.event || event.EVENT || event['event'] || 'unknown';

  try {
    // Route based on event type
    let result = null;
    if (eventType === 'ONCRMDEALUPDATE' || eventType.includes('UPDATE')) {
      result = await handleDealUpdate(dealId, requestId);
    } else if (eventType === 'ONCRMDEALADD' || eventType.includes('ADD')) {
      result = await handleDealCreate(dealId, requestId);
    } else {
      // ✅ Structured logging: [BITRIX_WEBHOOK_UNHANDLED_EVENT]
      console.log(JSON.stringify({
        event: 'BITRIX_WEBHOOK_UNHANDLED_EVENT',
        requestId,
        dealId,
        eventType,
        timestamp: new Date().toISOString()
      }));
      result = { success: true, triggerMatch: false, skip_reason: `unhandled_event_type:${eventType}` };
    }

    // ✅ Structured logging: [BITRIX_WEBHOOK_DONE]
    console.log(JSON.stringify({
      event: 'BITRIX_WEBHOOK_DONE',
      requestId,
      dealId,
      eventType,
      result,
      timestamp: new Date().toISOString()
    }));

    res.status(200).json({ 
      success: true, 
      message: 'Event processed',
      requestId,
      dealId,
      triggerMatch: result?.triggerMatch || false,
      skip_reason: result?.skip_reason || null
    });
  } catch (e) {
    // ✅ Structured logging: [BITRIX_WEBHOOK_ERROR]
    console.log(JSON.stringify({
      event: 'BITRIX_WEBHOOK_ERROR',
      requestId,
      dealId: dealId || 'unknown',
      error: e.message,
      stack: e.stack,
      timestamp: new Date().toISOString()
    }));
    
    res.status(500).json({ 
      error: 'Internal server error', 
      message: e.message,
      requestId
    });
  }
}

