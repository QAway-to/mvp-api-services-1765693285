/**
 * Shopify Fulfillment API
 * Handles fulfillment-related operations for Shopify orders
 */

import { callShopifyAdmin } from './adminClient.js';

/**
 * Get fulfillments for a specific order
 * @param {string|number} orderId - Shopify order ID
 * @returns {Promise<Object>} Response with fulfillments data
 */
export async function getFulfillmentOrders(orderId) {
  try {
    // Use Shopify Admin API to get order fulfillments
    // Endpoint: GET /admin/api/{version}/orders/{order_id}/fulfillments.json
    const response = await callShopifyAdmin(`/orders/${orderId}/fulfillments.json`);
    
    return {
      success: true,
      httpStatus: 200,
      fulfillments: response.fulfillments || [],
      count: response.fulfillments ? response.fulfillments.length : 0,
      fulfillmentIds: response.fulfillments ? response.fulfillments.map(f => f.id) : [],
      rawResponse: response
    };
  } catch (error) {
    // callShopifyAdmin throws Error with message like "Shopify Admin API error (401): ..."
    // Extract HTTP status code from error message
    const statusMatch = error.message.match(/\((\d+)\)/);
    const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : null;
    
    // Handle authentication errors (401/403)
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        success: false,
        httpStatus,
        error: 'SHOPIFY_ADMIN_AUTH_ERROR',
        message: error.message,
        fulfillments: [],
        count: 0,
        fulfillmentIds: []
      };
    }
    
    // Other errors (network, 404, 500, etc.)
    return {
      success: false,
      httpStatus: httpStatus || 500,
      error: 'SHOPIFY_FULFILLMENT_FETCH_ERROR',
      message: error.message,
      fulfillments: [],
      count: 0,
      fulfillmentIds: []
    };
  }
}

/**
 * Alternative: Get order with fulfillments included
 * This uses the order endpoint which includes fulfillments in the response
 * @param {string|number} orderId - Shopify order ID
 * @returns {Promise<Object>} Response with order and fulfillments data
 */
export async function getFulfillments(orderId) {
  try {
    // Get full order data (includes fulfillments)
    const response = await callShopifyAdmin(`/orders/${orderId}.json`);
    const order = response.order || {};
    const fulfillments = order.fulfillments || [];
    
    return {
      success: true,
      httpStatus: 200,
      fulfillments: fulfillments,
      count: fulfillments.length,
      fulfillmentIds: fulfillments.map(f => f.id),
      orderId: order.id,
      orderName: order.name,
      rawResponse: response
    };
  } catch (error) {
    // callShopifyAdmin throws Error with message like "Shopify Admin API error (401): ..."
    // Extract HTTP status code from error message
    const statusMatch = error.message.match(/\((\d+)\)/);
    const httpStatus = statusMatch ? parseInt(statusMatch[1], 10) : null;
    
    // Handle authentication errors (401/403)
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        success: false,
        httpStatus,
        error: 'SHOPIFY_ADMIN_AUTH_ERROR',
        message: error.message,
        fulfillments: [],
        count: 0,
        fulfillmentIds: []
      };
    }
    
    // Other errors (network, 404, 500, etc.)
    return {
      success: false,
      httpStatus: httpStatus || 500,
      error: 'SHOPIFY_FULFILLMENT_FETCH_ERROR',
      message: error.message,
      fulfillments: [],
      count: 0,
      fulfillmentIds: []
    };
  }
}

