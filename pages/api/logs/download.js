/**
 * API endpoint to download logs
 * Collects logs from recent operations and returns as text file
 */
import { shopifyAdapter } from '../../../src/lib/adapters/shopify/index.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Collect logs from various sources
    const logs = [];
    
    // Add timestamp
    logs.push('='.repeat(80));
    logs.push(`SHOPIFY-BITRIX INTEGRATION LOGS`);
    logs.push(`Generated: ${new Date().toISOString()}`);
    logs.push('='.repeat(80));
    logs.push('');

    // Environment information
    logs.push('='.repeat(80));
    logs.push('ENVIRONMENT INFORMATION');
    logs.push('='.repeat(80));
    logs.push('');
    logs.push(`Node.js Version: ${process.version}`);
    logs.push(`Platform: ${process.platform}`);
    logs.push(`Timestamp: ${new Date().toISOString()}`);
    logs.push('');

    // Get recent events
    logs.push('='.repeat(80));
    logs.push('RECENT WEBHOOK OPERATIONS');
    logs.push('='.repeat(80));
    logs.push('');

    try {
      const events = shopifyAdapter.getAllEvents();
      
      if (events && events.length > 0) {
        logs.push(`Total events: ${events.length}`);
        logs.push('');
        
        // Sort by received_at (most recent first)
        const sortedEvents = [...events].sort((a, b) => {
          const dateA = new Date(a.received_at || a.created_at || 0);
          const dateB = new Date(b.received_at || b.created_at || 0);
          return dateB - dateA;
        });

        sortedEvents.forEach((event, index) => {
          const eventId = event.id || event.eventId || `event-${index}`;
          const orderId = event.orderId || event.id || 'N/A';
          const receivedAt = event.received_at || event.created_at || 'N/A';
          const totalPrice = event.current_total_price || event.total_price || 'N/A';
          const currency = event.currency || 'EUR';
          const financialStatus = event.financial_status || 'N/A';
          const lineItemsCount = event.line_items ? event.line_items.length : 0;

          logs.push(`Event #${index + 1}: ${eventId}`);
          logs.push(`  Order ID: ${orderId}`);
          logs.push(`  Email: ${event.email || 'N/A'}`);
          logs.push(`  Received At: ${receivedAt}`);
          logs.push(`  Total Price: ${totalPrice} ${currency}`);
          logs.push(`  Financial Status: ${financialStatus}`);
          logs.push(`  Line Items: ${lineItemsCount}`);
          
          // Add line items details
          if (event.line_items && event.line_items.length > 0) {
            logs.push(`  Line Items Details:`);
            event.line_items.forEach((item, itemIndex) => {
              const currentQty = item.current_quantity ?? item.quantity ?? 0;
              logs.push(`    ${itemIndex + 1}. ${item.title || 'N/A'} (SKU: ${item.sku || 'N/A'})`);
              logs.push(`       Quantity: ${item.quantity || 0} → Current: ${currentQty}`);
              logs.push(`       Price: ${item.price || 'N/A'} ${currency}`);
            });
          }
          
          logs.push('');
        });
      } else {
        logs.push('No events found.');
        logs.push('');
      }
    } catch (error) {
      logs.push(`Error collecting events: ${error.message}`);
      logs.push('');
    }

    logs.push('='.repeat(80));
    logs.push('NOTE');
    logs.push('='.repeat(80));
    logs.push('');
    logs.push('For detailed server-side logs (console.log output), check:');
    logs.push('  - Server console output (stdout/stderr)');
    logs.push('  - Application logs in production environment');
    logs.push('  - Deployment platform logs (Vercel, Render, etc.)');
    logs.push('');
    logs.push('This log file includes:');
    logs.push('  - Recent webhook events received from Shopify');
    logs.push('  - Event metadata (order ID, amounts, statuses)');
    logs.push('  - Line items information');
    logs.push('');
    logs.push('='.repeat(80));
    logs.push(`End of log file - ${new Date().toISOString()}`);
    logs.push('='.repeat(80));

    // Convert to text
    const logText = logs.join('\n');

    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shopify-bitrix-logs-${Date.now()}.txt"`);
    
    res.status(200).send(logText);
  } catch (error) {
    console.error('[LOGS DOWNLOAD] Error:', error);
    res.status(500).json({ error: 'Failed to generate logs', message: error.message });
  }
}

