// Bitrix24 Webhook Adapter
// In-memory storage for received events from Bitrix outbound webhooks

let receivedEvents = [];

/**
 * Bitrix Webhook Adapter
 * Handles Bitrix webhook events storage and retrieval
 */
export class BitrixAdapter {
  constructor() {
    this.storage = receivedEvents; // Reference to in-memory array
  }

  getName() {
    return 'bitrix';
  }

  /**
   * Store webhook event
   * @param {Object} payload - Bitrix webhook event payload
   * @returns {Object} Stored event with timestamp
   */
  storeEvent(payload) {
    // Generate unique event ID (timestamp + random to ensure uniqueness)
    const uniqueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const event = {
      ...payload,
      received_at: payload.received_at || new Date().toISOString(),
      id: uniqueId, // Unique ID for each event
      eventId: uniqueId, // Also store as eventId for clarity
    };
    
    this.storage.push(event);
    return event;
  }

  /**
   * Get all events (newest first)
   * @returns {Array<Object>} All stored events
   */
  getAllEvents() {
    // Return events in reverse order (newest first)
    return [...this.storage].reverse();
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
}

// Export singleton instance
export const bitrixAdapter = new BitrixAdapter();

