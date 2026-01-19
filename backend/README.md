# Renewal Risk Backend

Express.js API for renewal risk calculation and webhook delivery.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| DATABASE_URL | PostgreSQL connection string | postgresql://postgres:postgres@localhost:5432/renewal_risk |
| PORT | Server port | 3001 |
| WEBHOOK_SECRET | HMAC signing secret for webhooks | - |

## API Endpoints

### Risk Calculation

**POST** `/api/v1/properties/:propertyId/renewal-risk/calculate`

Triggers risk calculation for all residents in a property.

Request:
```json
{
  "asOfDate": "2026-01-18"
}
```

Response:
```json
{
  "propertyId": "...",
  "calculatedAt": "2026-01-18T...",
  "totalResidents": 15,
  "flaggedCount": 10,
  "riskTiers": { "high": 3, "medium": 7, "low": 5 },
  "flags": [
    {
      "residentId": "...",
      "name": "Jane Doe",
      "unitId": "101",
      "riskScore": 85,
      "riskTier": "high",
      "daysToExpiry": 45,
      "signals": {
        "daysToExpiryDays": 45,
        "paymentHistoryDelinquent": false,
        "noRenewalOfferYet": true,
        "rentGrowthAboveMarket": false
      }
    }
  ]
}
```

---

**GET** `/api/v1/properties/:propertyId/renewal-risk`

Returns the most recent risk calculation results.

---

### Webhook Delivery

**POST** `/api/v1/properties/:propertyId/residents/:residentId/trigger-event`

Triggers a webhook event for a specific resident.

Response (success):
```json
{
  "message": "Webhook delivered successfully on attempt 1",
  "eventId": "evt_30214fdb_e6289c8f_1234567890"
}
```

Response (idempotent - already triggered):
```json
{
  "message": "Event already exists with status: delivered",
  "eventId": "evt_...",
  "alreadyExists": true
}
```

---

**GET** `/api/v1/properties/:propertyId/residents/:residentId/webhook-status`

Returns webhook delivery status for a resident.

## Database Schema

### New Tables (created by this feature)

- `renewal_risk_scores` - Stores calculated risk scores
- `webhook_events` - Tracks webhook delivery lifecycle
- `webhook_dlq` - Dead letter queue for failed webhooks
- `rms_endpoints` - RMS webhook configuration per property

See `migrations/002_renewal_risk_schema.sql` for full schema.

## Webhook Security & Verification (for RMS implementers)

When receiving webhooks from this system, the RMS should verify authenticity to prevent spoofing.

### Webhook Headers

Each webhook request includes these headers:

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Webhook-Signature` | HMAC-SHA256 signature of the payload |
| `X-Event-Id` | Unique event ID for idempotency |

### Webhook Payload Format

```json
{
  "event": "renewal.risk_flagged",
  "eventId": "evt_30214fdb_e6289c8f_1234567890",
  "timestamp": "2026-01-18T14:30:00Z",
  "propertyId": "30214fdb-5381-4d9c-adfe-c59fccb4099d",
  "residentId": "e6289c8f-45a1-468d-8191-1fe0244fc2d3",
  "data": {
    "riskScore": 85,
    "riskTier": "high",
    "daysToExpiry": 45,
    "signals": {
      "daysToExpiryDays": 45,
      "paymentHistoryDelinquent": false,
      "noRenewalOfferYet": true,
      "rentGrowthAboveMarket": false
    }
  }
}
```

### Signature Verification (Node.js)

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(req, secret) {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Express middleware example
app.post('/webhook', express.json(), (req, res) => {
  if (!verifyWebhookSignature(req, process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process the webhook
  const { eventId, data } = req.body;
  console.log(`Received risk event: ${eventId}, score: ${data.riskScore}`);

  res.status(200).json({ received: true });
});
```

### Signature Verification (Python)

```python
import hmac
import hashlib
import json

def verify_webhook_signature(payload_bytes, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload_bytes,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)

# Flask example
@app.route('/webhook', methods=['POST'])
def handle_webhook():
    signature = request.headers.get('X-Webhook-Signature')
    if not verify_webhook_signature(request.data, signature, WEBHOOK_SECRET):
        return {'error': 'Invalid signature'}, 401

    data = request.json
    print(f"Received: {data['eventId']}")
    return {'received': True}, 200
```

### Idempotency

The `eventId` (also in `X-Event-Id` header) is unique per event. RMS should:

1. Store processed event IDs
2. Check if an event ID was already processed before acting on it
3. Return 200 OK for duplicate events (don't reprocess)

```javascript
// Pseudocode
if (await wasEventProcessed(req.body.eventId)) {
  return res.status(200).json({ received: true, duplicate: true });
}

await processEvent(req.body);
await markEventProcessed(req.body.eventId);
res.status(200).json({ received: true });
```

### Best Practices

1. **Always verify signatures** - Never process unsigned webhooks
2. **Use timing-safe comparison** - Prevents timing attacks
3. **Implement idempotency** - Handle duplicate deliveries gracefully
4. **Return 2xx quickly** - Long processing should be async
5. **Log event IDs** - Helps debugging delivery issues

## Edge Case Handling

### RMS Endpoint Unreachable

When the RMS endpoint is unavailable or returns a non-2xx response:

1. **Exponential backoff** - Retries at 1s, 2s, 4s, 8s, 16s intervals (5 attempts total)
2. **Non-blocking** - Webhook delivery is fire-and-forget; the API returns immediately while retries happen in the background
3. **Dead Letter Queue** - After 5 failed attempts, the event is moved to `webhook_dlq` with the failure reason
4. **Status tracking** - Each attempt updates `webhook_events` with response code, body, and next retry time

### Lease Already Expired

Residents with expired fixed-term leases are still included in risk calculations:

- `days_to_expiry` will be negative (e.g., -30 if lease ended 30 days ago)
- Risk score will be very high due to the days-to-expiry factor
- This allows property managers to identify residents who may be on month-to-month holdover

### Month-to-Month Leases

Month-to-month leases don't have a fixed end date. The system handles this by:

- Treating MTM residents as having 30 days to expiry (typical notice period)
- See `D006` in `ai/design.adoc` for rationale

### No Market Rent Data Available

If `market_rents` has no entry for a unit:

- The `rentGrowthAboveMarket` signal defaults to `false`
- The resident is still scored on the other 3 factors
- This prevents false positives when market data is incomplete

### Batch Job Triggered Twice Simultaneously

If `/renewal-risk/calculate` is called twice at the same time:

- Both calls will execute and create separate risk score records
- Each record has a unique `calculated_at` timestamp
- The GET endpoint returns the most recent calculation (ordered by `calculated_at DESC`)
- No data corruption occurs; worst case is duplicate computation

For production, you could add:
- A distributed lock (e.g., Redis `SETNX`)
- Database advisory locks (`pg_advisory_lock`)
- Rate limiting on the endpoint

### Duplicate Webhook Triggers

If a user clicks "Trigger Event" twice:

- The system checks for existing events within the last hour (idempotency window)
- Returns `alreadyExists: true` instead of creating a duplicate
- See `checkIdempotency()` in `webhookDelivery.ts`

---

## AI Assistance

This project was developed with assistance from Claude (Anthropic). The AI was used for:

- Code generation and implementation
- Architecture and design discussions
- Documentation writing
- Debugging and troubleshooting

All AI-generated code was reviewed, tested, and modified as needed. Design decisions were made collaboratively with the human developer, with rationale documented in `ai/design.adoc`.
