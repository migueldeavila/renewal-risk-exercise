import crypto from 'crypto';
import { pool } from '../db';
import { WebhookPayload, RiskSignals } from '../types';

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Generate a unique event ID for idempotency
 */
function generateEventId(propertyId: string, residentId: string): string {
  const timestamp = Date.now();
  return `evt_${propertyId.slice(0, 8)}_${residentId.slice(0, 8)}_${timestamp}`;
}

/**
 * Get RMS endpoint configuration for a property
 */
async function getRmsEndpoint(
  propertyId: string
): Promise<{ url: string; secret: string } | null> {
  const result = await pool.query(
    `SELECT endpoint_url, signing_secret
     FROM rms_endpoints
     WHERE property_id = $1 AND is_active = true`,
    [propertyId]
  );

  if (result.rows.length === 0) return null;

  return {
    url: result.rows[0].endpoint_url,
    secret: result.rows[0].signing_secret,
  };
}

/**
 * Check if an event has already been created for this resident recently
 * (within the last hour) to prevent duplicate triggers
 */
async function checkIdempotency(
  propertyId: string,
  residentId: string
): Promise<{ exists: boolean; eventId?: string; status?: string }> {
  const result = await pool.query(
    `SELECT event_id, status
     FROM webhook_events
     WHERE property_id = $1
       AND resident_id = $2
       AND event_type = 'renewal.risk_flagged'
       AND created_at > NOW() - INTERVAL '1 hour'
     ORDER BY created_at DESC
     LIMIT 1`,
    [propertyId, residentId]
  );

  if (result.rows.length > 0) {
    return {
      exists: true,
      eventId: result.rows[0].event_id,
      status: result.rows[0].status,
    };
  }

  return { exists: false };
}

/**
 * Create a webhook event record
 */
async function createWebhookEvent(
  eventId: string,
  propertyId: string,
  residentId: string,
  payload: WebhookPayload
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO webhook_events (
      event_id, property_id, resident_id, event_type, payload, status, next_retry_at
    ) VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
    RETURNING id`,
    [eventId, propertyId, residentId, 'renewal.risk_flagged', JSON.stringify(payload)]
  );

  return result.rows[0].id;
}

/**
 * Update webhook event after delivery attempt
 */
async function updateWebhookEvent(
  eventId: string,
  success: boolean,
  responseCode: number | null,
  responseBody: string | null,
  attemptCount: number
): Promise<void> {
  if (success) {
    await pool.query(
      `UPDATE webhook_events
       SET status = 'delivered',
           attempt_count = $2,
           last_attempt_at = NOW(),
           last_response_code = $3,
           last_response_body = $4,
           delivered_at = NOW(),
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE event_id = $1`,
      [eventId, attemptCount, responseCode, responseBody]
    );
  } else if (attemptCount >= MAX_RETRY_ATTEMPTS) {
    // Move to failed status (will be moved to DLQ)
    await pool.query(
      `UPDATE webhook_events
       SET status = 'failed',
           attempt_count = $2,
           last_attempt_at = NOW(),
           last_response_code = $3,
           last_response_body = $4,
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE event_id = $1`,
      [eventId, attemptCount, responseCode, responseBody]
    );
  } else {
    // Schedule retry with exponential backoff
    const nextDelayMs = RETRY_DELAYS_MS[attemptCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
    await pool.query(
      `UPDATE webhook_events
       SET status = 'pending',
           attempt_count = $2,
           last_attempt_at = NOW(),
           last_response_code = $3,
           last_response_body = $4,
           next_retry_at = NOW() + INTERVAL '${nextDelayMs} milliseconds',
           updated_at = NOW()
       WHERE event_id = $1`,
      [eventId, attemptCount, responseCode, responseBody]
    );
  }
}

/**
 * Move failed webhook to Dead Letter Queue
 */
async function moveToDeadLetterQueue(
  webhookEventId: string,
  reason: string
): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_dlq (webhook_event_id, failure_reason)
     VALUES ($1, $2)`,
    [webhookEventId, reason]
  );
}

/**
 * Attempt to deliver webhook to RMS endpoint
 */
async function deliverWebhook(
  url: string,
  payload: WebhookPayload,
  secret: string
): Promise<{ success: boolean; statusCode: number | null; body: string | null }> {
  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr, secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Event-Id': payload.eventId,
      },
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const body = await response.text();
    const success = response.status >= 200 && response.status < 300;

    return { success, statusCode: response.status, body };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, statusCode: null, body: errorMessage };
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main function: Trigger renewal event webhook for a resident
 *
 * This function:
 * 1. Checks idempotency (has this been triggered recently?)
 * 2. Creates webhook event record
 * 3. Attempts delivery with retries
 * 4. Moves to DLQ if all retries fail
 */
export async function triggerRenewalEvent(
  propertyId: string,
  residentId: string,
  riskData: {
    riskScore: number;
    riskTier: 'high' | 'medium' | 'low';
    daysToExpiry: number;
    signals: RiskSignals;
  }
): Promise<{
  success: boolean;
  eventId: string;
  message: string;
  alreadyExists?: boolean;
}> {
  // Check idempotency
  const idempotencyCheck = await checkIdempotency(propertyId, residentId);
  if (idempotencyCheck.exists) {
    return {
      success: idempotencyCheck.status === 'delivered',
      eventId: idempotencyCheck.eventId!,
      message: `Event already exists with status: ${idempotencyCheck.status}`,
      alreadyExists: true,
    };
  }

  // Get RMS endpoint
  const rmsEndpoint = await getRmsEndpoint(propertyId);
  if (!rmsEndpoint) {
    return {
      success: false,
      eventId: '',
      message: 'No RMS endpoint configured for this property',
    };
  }

  // Generate event ID and create payload
  const eventId = generateEventId(propertyId, residentId);
  const payload: WebhookPayload = {
    event: 'renewal.risk_flagged',
    eventId,
    timestamp: new Date().toISOString(),
    propertyId,
    residentId,
    data: riskData,
  };

  // Create webhook event record
  const webhookDbId = await createWebhookEvent(eventId, propertyId, residentId, payload);

  // Attempt delivery with retries
  let attemptCount = 0;
  let lastResult = { success: false, statusCode: null as number | null, body: null as string | null };

  while (attemptCount < MAX_RETRY_ATTEMPTS) {
    attemptCount++;

    lastResult = await deliverWebhook(rmsEndpoint.url, payload, rmsEndpoint.secret);

    await updateWebhookEvent(
      eventId,
      lastResult.success,
      lastResult.statusCode,
      lastResult.body,
      attemptCount
    );

    if (lastResult.success) {
      return {
        success: true,
        eventId,
        message: `Webhook delivered successfully on attempt ${attemptCount}`,
      };
    }

    // Wait before retry (except on last attempt)
    if (attemptCount < MAX_RETRY_ATTEMPTS) {
      const delayMs = RETRY_DELAYS_MS[attemptCount - 1];
      await sleep(delayMs);
    }
  }

  // All retries failed - move to DLQ
  await moveToDeadLetterQueue(
    webhookDbId,
    `Failed after ${MAX_RETRY_ATTEMPTS} attempts. Last error: ${lastResult.body || 'Unknown'}`
  );

  return {
    success: false,
    eventId,
    message: `Webhook delivery failed after ${MAX_RETRY_ATTEMPTS} attempts. Moved to DLQ.`,
  };
}

/**
 * Get webhook status for a resident
 */
export async function getWebhookStatus(
  propertyId: string,
  residentId: string
): Promise<{
  eventId: string;
  status: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
} | null> {
  const result = await pool.query(
    `SELECT event_id, status, attempt_count, last_attempt_at, delivered_at
     FROM webhook_events
     WHERE property_id = $1 AND resident_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [propertyId, residentId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    eventId: row.event_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at?.toISOString() || null,
    deliveredAt: row.delivered_at?.toISOString() || null,
  };
}
