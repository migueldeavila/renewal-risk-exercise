const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 4000;

// The signing secret must match what's in rms_endpoints table
const SIGNING_SECRET = process.env.SIGNING_SECRET || 'dev-webhook-secret';

// Simulate failure rate for testing retries (0-100)
const FAILURE_RATE = parseInt(process.env.FAILURE_RATE || '0', 10);

// Store received events for inspection
const receivedEvents = [];

// Parse raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

/**
 * Verify HMAC-SHA256 signature
 */
function verifySignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * POST /webhook - Receive renewal risk events
 */
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const eventId = req.headers['x-event-id'];
  const timestamp = new Date().toISOString();

  console.log('\n' + '='.repeat(60));
  console.log(`[${timestamp}] Webhook received`);
  console.log('='.repeat(60));

  // Check for signature header
  if (!signature) {
    console.log('ERROR: Missing X-Webhook-Signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Verify signature
  const isValid = verifySignature(req.rawBody, signature, SIGNING_SECRET);

  if (!isValid) {
    console.log('ERROR: Invalid signature');
    console.log(`  Received: ${signature}`);
    console.log(`  Secret used: ${SIGNING_SECRET}`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  console.log('Signature: VALID');

  // Simulate random failures for testing retry logic
  if (FAILURE_RATE > 0 && Math.random() * 100 < FAILURE_RATE) {
    console.log(`Simulating failure (FAILURE_RATE=${FAILURE_RATE}%)`);
    return res.status(503).json({ error: 'Simulated failure' });
  }

  // Check for duplicate events (idempotency)
  const existingEvent = receivedEvents.find(e => e.eventId === eventId);
  if (existingEvent) {
    console.log(`Duplicate event detected: ${eventId}`);
    console.log(`  First received: ${existingEvent.receivedAt}`);
    // Return success - idempotent handling
    return res.status(200).json({
      status: 'duplicate',
      message: 'Event already processed',
      eventId
    });
  }

  // Store the event
  const event = {
    eventId,
    receivedAt: timestamp,
    payload: req.body
  };
  receivedEvents.push(event);

  // Log payload details
  console.log(`Event ID: ${eventId}`);
  console.log(`Event Type: ${req.body.event}`);
  console.log(`Property ID: ${req.body.propertyId}`);
  console.log(`Resident ID: ${req.body.residentId}`);

  if (req.body.data) {
    console.log(`Risk Score: ${req.body.data.riskScore}`);
    console.log(`Risk Tier: ${req.body.data.riskTier}`);
    console.log(`Days to Expiry: ${req.body.data.daysToExpiry}`);
    console.log('Signals:', JSON.stringify(req.body.data.signals, null, 2));
  }

  console.log('='.repeat(60));
  console.log(`Total events received: ${receivedEvents.length}`);

  res.status(200).json({
    status: 'received',
    eventId,
    message: 'Webhook processed successfully'
  });
});

/**
 * GET /events - View all received events
 */
app.get('/events', (req, res) => {
  res.json({
    count: receivedEvents.length,
    events: receivedEvents
  });
});

/**
 * DELETE /events - Clear received events
 */
app.delete('/events', (req, res) => {
  receivedEvents.length = 0;
  console.log('Events cleared');
  res.json({ message: 'Events cleared' });
});

/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    signingSecretConfigured: !!SIGNING_SECRET,
    failureRate: FAILURE_RATE,
    eventsReceived: receivedEvents.length
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
========================================
  Mock RMS Server
========================================
  Port: ${PORT}
  Signing Secret: ${SIGNING_SECRET}
  Failure Rate: ${FAILURE_RATE}%

Endpoints:
  POST /webhook     - Receive webhooks
  GET  /events      - View received events
  DELETE /events    - Clear events
  GET  /health      - Health check
========================================
`);
});
