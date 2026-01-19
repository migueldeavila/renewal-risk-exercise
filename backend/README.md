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

## Webhook Signing

Webhooks include an HMAC-SHA256 signature in the `X-Webhook-Signature` header.

To verify:
```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(payload))
  .digest('hex');

if (signature === request.headers['x-webhook-signature']) {
  // Valid signature
}
```
