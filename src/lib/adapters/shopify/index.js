// Shopify Webhook Adapter
// In-memory storage for received events
import { mapShopifyOrderToBitrixDeal } from '../../bitrix/orderMapper.js';
import { BITRIX_CONFIG, financialStatusToStageId } from '../../bitrix/config.js';

let receivedEvents = [];

/**
 * Shopify Webhook Adapter
 * Handles Shopify webhook events storage and retrieval
 */
export class ShopifyAdapter {
  constructor() {
    this.storage = receivedEvents; // Reference to in-memory array
  }

  getName() {
    return 'shopify';
  }

  /**
   * Validate Shopify webhook payload against simplified schema
   * @param {Object} payload - Webhook payload to validate
   * @returns {Object} { valid: boolean, errors: Array<string> }
   */
  validateWebhookPayload(payload) {
    const errors = [];
    
    if (!payload || typeof payload !== 'object') {
      return { valid: false, errors: ['Payload must be an object'] };
    }

    // Check required top-level fields (simplified validation)
    if (payload.id !== undefined && typeof payload.id !== 'number') {
      errors.push('id must be a number');
    }
    
    if (payload.email !== undefined && typeof payload.email !== 'string') {
      errors.push('email must be a string');
    }
    
    if (payload.created_at !== undefined && typeof payload.created_at !== 'string') {
      errors.push('created_at must be a string');
    }
    
    if (payload.currency !== undefined && typeof payload.currency !== 'string') {
      errors.push('currency must be a string');
    }
    
    if (payload.total_price !== undefined && typeof payload.total_price !== 'string') {
      errors.push('total_price must be a string');
    }

    // Validate line_items if present
    if (payload.line_items !== undefined) {
      if (!Array.isArray(payload.line_items)) {
        errors.push('line_items must be an array');
      } else {
        payload.line_items.forEach((item, index) => {
          if (item.id !== undefined && typeof item.id !== 'number') {
            errors.push(`line_items[${index}].id must be a number`);
          }
          if (item.quantity !== undefined && typeof item.quantity !== 'number') {
            errors.push(`line_items[${index}].quantity must be a number`);
          }
          if (item.title !== undefined && typeof item.title !== 'string') {
            errors.push(`line_items[${index}].title must be a string`);
          }
          if (item.price !== undefined && typeof item.price !== 'string') {
            errors.push(`line_items[${index}].price must be a string`);
          }
          if (item.sku !== undefined && typeof item.sku !== 'string') {
            errors.push(`line_items[${index}].sku must be a string`);
          }
        });
      }
    }

    // Validate discount_codes if present
    if (payload.discount_codes !== undefined) {
      if (!Array.isArray(payload.discount_codes)) {
        errors.push('discount_codes must be an array');
      } else {
        payload.discount_codes.forEach((code, index) => {
          if (code.code !== undefined && typeof code.code !== 'string') {
            errors.push(`discount_codes[${index}].code must be a string`);
          }
          if (code.amount !== undefined && typeof code.amount !== 'string') {
            errors.push(`discount_codes[${index}].amount must be a string`);
          }
          if (code.type !== undefined && typeof code.type !== 'string') {
            errors.push(`discount_codes[${index}].type must be a string`);
          }
        });
      }
    }

    // Validate customer if present
    if (payload.customer !== undefined) {
      if (typeof payload.customer !== 'object') {
        errors.push('customer must be an object');
      } else {
        if (payload.customer.id !== undefined && typeof payload.customer.id !== 'number') {
          errors.push('customer.id must be a number');
        }
        if (payload.customer.first_name !== undefined && typeof payload.customer.first_name !== 'string') {
          errors.push('customer.first_name must be a string');
        }
        if (payload.customer.last_name !== undefined && typeof payload.customer.last_name !== 'string') {
          errors.push('customer.last_name must be a string');
        }
        if (payload.customer.email !== undefined && typeof payload.customer.email !== 'string') {
          errors.push('customer.email must be a string');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Store webhook event
   * @param {Object} payload - Validated webhook payload
   * @returns {Object} Stored event with timestamp
   */
  storeEvent(payload) {
    // Generate unique event ID (timestamp + random to ensure uniqueness)
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const event = {
      ...payload,
      received_at: new Date().toISOString(),
      id: uniqueId, // Unique ID for each event
      eventId: uniqueId, // Also store as eventId for clarity
      orderId: payload.id || null // Store original order ID separately
    };
    
    this.storage.push(event);
    return event;
  }

  /**
   * Get all events (newest first, deduplicated by orderId + received_at)
   * @returns {Array<Object>} All stored events
   */
  getAllEvents() {
    // Remove duplicates: keep only the latest event for each unique orderId
    const seen = new Map();
    const uniqueEvents = [];
    
    // Process in reverse order (newest first) and keep only the first occurrence
    for (let i = this.storage.length - 1; i >= 0; i--) {
      const event = this.storage[i];
      const orderId = event.orderId || event.id;
      
      // If we haven't seen this orderId yet, or this event is newer, keep it
      if (!seen.has(orderId)) {
        seen.set(orderId, event);
        uniqueEvents.unshift(event); // Add to beginning to maintain newest-first order
      }
    }
    
    return uniqueEvents;
  }

  /**
   * Get latest event
   * @returns {Object|null} Latest event or null
   */
  getLatestEvent() {
    if (this.storage.length === 0) {
      return null;
    }
    return this.storage[this.storage.length - 1];
  }

  /**
   * Get events count
   * @returns {number} Number of stored events
   */
  getEventsCount() {
    return this.storage.length;
  }

  /**
   * Clear all events (for testing/reset)
   * @returns {number} Number of cleared events
   */
  clearEvents() {
    const count = this.storage.length;
    this.storage.length = 0;
    return count;
  }

  /**
   * Transform Shopify order to Bitrix24 crm.deal.add format
   * Uses the unified mapShopifyOrderToBitrixDeal mapper to ensure consistency
   * @param {Object} shopifyOrder - Shopify webhook order data (from storeEvent, may have orderId property)
   * @returns {Object} Bitrix24 deal format
   */
  transformToBitrix(shopifyOrder) {
    if (!shopifyOrder || typeof shopifyOrder !== 'object') {
      throw new Error('Invalid Shopify order data');
    }

    // ✅ CRITICAL: Use orderId (stable order.id from Shopify), not id (which might be eventId)
    // In storeEvent, we store: id = eventId (unique), orderId = payload.id (stable order.id)
    // So use orderId if available, otherwise fall back to id (for backward compatibility)
    const stableOrderId = shopifyOrder.orderId || shopifyOrder.id;
    
    // Prepare order object for mapper (ensure id is the stable order.id, not eventId)
    const orderForMapper = {
      ...shopifyOrder,
      id: stableOrderId, // Use stable order.id
      // Preserve eventId if it exists for UF_SHOPIFY_EVENT_ID
      eventId: shopifyOrder.eventId || shopifyOrder.id, // eventId might be in id if this came from storeEvent
    };
    
    // Use the unified mapper function (same as webhook handlers)
    // This ensures consistency: CATEGORY_ID, STAGE_ID, UF_SHOPIFY_ORDER_ID are all set correctly
    const { dealFields } = mapShopifyOrderToBitrixDeal(orderForMapper);
    
    // ✅ ENSURE: UF_CRM_1742556489 (Shopify number) uses stable order.id (not eventId)
    dealFields.UF_CRM_1742556489 = String(stableOrderId);

    // ✅ ENSURE: CATEGORY_ID and STAGE_ID are set (they should be set by mapShopifyOrderToBitrixDeal)
    // But verify they're not null (fail-safe check)
    if (!dealFields.CATEGORY_ID) {
      // Determine category based on order tags
      const orderTags = Array.isArray(shopifyOrder.tags) 
        ? shopifyOrder.tags 
        : (shopifyOrder.tags ? String(shopifyOrder.tags).split(',').map(t => t.trim()) : []);
      const preorderTags = ['pre-order', 'preorder-product-added'];
      const hasPreorderTag = orderTags.some(tag => 
        preorderTags.some(preorderTag => tag.toLowerCase() === preorderTag.toLowerCase())
      );
      dealFields.CATEGORY_ID = hasPreorderTag ? BITRIX_CONFIG.CATEGORY_PREORDER : BITRIX_CONFIG.CATEGORY_STOCK;
    }
    
    if (!dealFields.STAGE_ID) {
      // Map financial status to stage ID using the same function as webhook handlers
      dealFields.STAGE_ID = financialStatusToStageId(
        shopifyOrder.financial_status,
        dealFields.CATEGORY_ID || BITRIX_CONFIG.CATEGORY_STOCK,
        null // currentStageId (not needed for new deals)
      );
    }
    
    // Return in the format expected by send-to-bitrix endpoint
    return {
      fields: dealFields
    };
  }
}

// Export singleton instance
export const shopifyAdapter = new ShopifyAdapter();

