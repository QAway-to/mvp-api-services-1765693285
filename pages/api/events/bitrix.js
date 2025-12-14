// Get all Bitrix events
import { bitrixAdapter } from '../../../src/lib/adapters/bitrix/index.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const events = bitrixAdapter.getAllEvents();
    
    return res.status(200).json({
      success: true,
      events: events,
      count: events.length
    });
  } catch (error) {
    console.error('Get Bitrix events error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Bitrix events',
      message: error.message
    });
  }
}

