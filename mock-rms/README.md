# Mock RMS Server

A simple mock Revenue Management System (RMS) server for testing webhook delivery and HMAC signature verification.

## Setup

```bash
cd mock-rms
npm install
npm start
```

The server runs on port 4000 by default.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `4000` | Server port |
| `SIGNING_SECRET` | `dev-webhook-secret` | HMAC-SHA256 signing secret |
| `FAILURE_RATE` | `0` | Simulate failures (0-100%) for testing retries |

**Important:** The `SIGNING_SECRET` must match the `signing_secret` column in the `rms_endpoints` database table. The seed data (`backend/migrations/003_seed_data.sql`) sets this to `dev-webhook-secret`.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/webhook` | Receive webhooks (verifies signature) |
| GET | `/events` | View all received events |
| DELETE | `/events` | Clear received events |
| GET | `/health` | Health check |

## Database Configuration

Update the `rms_endpoints` table to point to this server:

```sql
UPDATE rms_endpoints
SET endpoint_url = 'http://localhost:4000/webhook'
WHERE property_id = '30214fdb-5381-4d9c-adfe-c59fccb4099d';
```

## Testing Retries

To test the retry logic with exponential backoff, start the server with a failure rate:

```bash
FAILURE_RATE=50 npm start
```

This will randomly fail 50% of requests with a 503 status, triggering the backend's retry mechanism.

## Signature Verification

The server verifies webhooks using HMAC-SHA256:

1. Reads the `X-Webhook-Signature` header
2. Computes HMAC-SHA256 of the raw request body using `SIGNING_SECRET`
3. Compares signatures using timing-safe comparison
4. Returns 401 if signature is missing or invalid

Example of how the backend signs requests:

```javascript
const crypto = require('crypto');

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
```
