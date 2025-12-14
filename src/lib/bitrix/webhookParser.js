/**
 * Bitrix Webhook Payload Parser
 * Handles different payload formats from Bitrix (JSON and form-urlencoded)
 */

/**
 * Extract deal ID from Bitrix webhook payload
 * Supports multiple formats: JSON nested objects and form-urlencoded strings
 * @param {Object} body - Request body (parsed by Next.js)
 * @returns {Object} { dealId: string|null, extractionPath: string|null }
 */
export function extractDealId(body) {
  if (!body || typeof body !== 'object') {
    return { dealId: null, extractionPath: null };
  }

  // Try JSON nested formats first
  if (body.data?.FIELDS?.ID) {
    return { dealId: String(body.data.FIELDS.ID), extractionPath: 'data.FIELDS.ID' };
  }
  if (body.data?.FIELDS?.id) {
    return { dealId: String(body.data.FIELDS.id), extractionPath: 'data.FIELDS.id' };
  }
  if (body.data?.ID) {
    return { dealId: String(body.data.ID), extractionPath: 'data.ID' };
  }
  if (body.data?.id) {
    return { dealId: String(body.data.id), extractionPath: 'data.id' };
  }
  if (body.FIELDS?.ID) {
    return { dealId: String(body.FIELDS.ID), extractionPath: 'FIELDS.ID' };
  }
  if (body.FIELDS?.id) {
    return { dealId: String(body.FIELDS.id), extractionPath: 'FIELDS.id' };
  }
  if (body.ID) {
    return { dealId: String(body.ID), extractionPath: 'ID' };
  }
  if (body.id) {
    return { dealId: String(body.id), extractionPath: 'id' };
  }

  // Try form-urlencoded string keys (Bitrix UI sends these)
  if (body['data[FIELDS][ID]']) {
    return { dealId: String(body['data[FIELDS][ID]']), extractionPath: 'data[FIELDS][ID]' };
  }
  if (body['data[FIELDS][id]']) {
    return { dealId: String(body['data[FIELDS][id]']), extractionPath: 'data[FIELDS][id]' };
  }
  if (body['data[ID]']) {
    return { dealId: String(body['data[ID]']), extractionPath: 'data[ID]' };
  }
  if (body['data[id]']) {
    return { dealId: String(body['data[id]']), extractionPath: 'data[id]' };
  }
  if (body['FIELDS[ID]']) {
    return { dealId: String(body['FIELDS[ID]']), extractionPath: 'FIELDS[ID]' };
  }
  if (body['FIELDS[id]']) {
    return { dealId: String(body['FIELDS[id]']), extractionPath: 'FIELDS[id]' };
  }
  if (body['ID']) {
    return { dealId: String(body['ID']), extractionPath: 'ID' };
  }

  return { dealId: null, extractionPath: null };
}

/**
 * Extract auth token from Bitrix webhook payload
 * @param {Object} body - Request body (parsed by Next.js)
 * @returns {string|null} Auth token or null
 */
export function extractAuthToken(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }

  // Try JSON nested format
  if (body.auth?.application_token) {
    return String(body.auth.application_token);
  }

  // Try form-urlencoded string key
  if (body['auth[application_token]']) {
    return String(body['auth[application_token]']);
  }

  return null;
}

/**
 * Get all keys from request body (for logging)
 * @param {Object} body - Request body
 * @returns {string[]} Array of keys
 */
export function getPayloadKeys(body) {
  if (!body || typeof body !== 'object') {
    return [];
  }
  return Object.keys(body);
}

