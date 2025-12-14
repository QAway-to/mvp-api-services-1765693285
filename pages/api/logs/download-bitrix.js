/**
 * API endpoint to download Bitrix logs
 * Collects logs from recent Bitrix webhook operations and returns as text file
 */
import { bitrixAdapter } from '../../../src/lib/adapters/bitrix/index.js';

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
    logs.push(`BITRIX-SHOPIFY INTEGRATION LOGS`);
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

    // Get recent Bitrix events
    logs.push('='.repeat(80));
    logs.push('RECENT BITRIX WEBHOOK OPERATIONS');
    logs.push('='.repeat(80));
    logs.push('');

    try {
      const events = bitrixAdapter.getAllEvents();
      
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
          const dealId = event.dealId || 'N/A';
          const shopifyOrderId = event.shopifyOrderId || 'N/A';
          const receivedAt = event.received_at || event.created_at || 'N/A';
          const categoryId = event.categoryId || 'N/A';
          const stageId = event.stageId || 'N/A';
          const comments = event.comments || 'N/A';

          logs.push(`Event #${index + 1}: ${eventId}`);
          logs.push(`  Deal ID: ${dealId}`);
          logs.push(`  Shopify Order ID: ${shopifyOrderId}`);
          logs.push(`  Category ID: ${categoryId}`);
          logs.push(`  Stage ID: ${stageId}`);
          logs.push(`  Received At: ${receivedAt}`);
          logs.push(`  Comments: ${comments}`);
          
          // Add raw deal data if available
          if (event.rawDealData) {
            logs.push(`  Raw Deal Data (summary):`);
            const dealData = event.rawDealData;
            logs.push(`    TITLE: ${dealData.TITLE || 'N/A'}`);
            logs.push(`    OPPORTUNITY: ${dealData.OPPORTUNITY || 'N/A'}`);
            logs.push(`    CURRENCY_ID: ${dealData.CURRENCY_ID || 'N/A'}`);
            logs.push(`    UF_CRM_1742556489 (Shopify Order ID): ${dealData.UF_CRM_1742556489 || 'N/A'}`);
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
    logs.push('  - Recent webhook events received from Bitrix');
    logs.push('  - Event metadata (deal ID, Shopify order ID, category, stage)');
    logs.push('  - Deal information');
    logs.push('');
    logs.push('='.repeat(80));
    logs.push(`End of log file - ${new Date().toISOString()}`);
    logs.push('='.repeat(80));

    // Convert to text
    const logText = logs.join('\n');

    // Set headers for file download
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bitrix-shopify-logs-${Date.now()}.txt"`);
    
    res.status(200).send(logText);
  } catch (error) {
    console.error('[BITRIX LOGS DOWNLOAD] Error:', error);
    res.status(500).json({ error: 'Failed to generate logs', message: error.message });
  }
}

