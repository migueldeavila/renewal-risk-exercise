# Renewal Risk Detection System

A full-stack application that identifies residents at risk of not renewing their leases and delivers webhook notifications to an external Revenue Management System (RMS).

## Quick Start

### Prerequisites
- Docker Desktop (running)
- Node.js v18+
- npm

### Setup

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Run migrations (includes seed data)
docker exec -i renewal_risk_db psql -U postgres -d renewal_risk < backend/migrations/001_starter_schema.sql
docker exec -i renewal_risk_db psql -U postgres -d renewal_risk < backend/migrations/002_renewal_risk_schema.sql
docker exec -i renewal_risk_db psql -U postgres -d renewal_risk < backend/migrations/003_seed_data.sql

# 3. Start backend
cd backend
cp .env.example .env
npm install
npm run dev

# 4. Start frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Access
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Property ID** (from seed): `30214fdb-5381-4d9c-adfe-c59fccb4099d`

## Testing

### Calculate Risk Scores
```bash
curl -X POST http://localhost:3001/api/v1/properties/30214fdb-5381-4d9c-adfe-c59fccb4099d/renewal-risk/calculate \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-01-18"}'
```

### Get Risk Data
```bash
curl http://localhost:3001/api/v1/properties/30214fdb-5381-4d9c-adfe-c59fccb4099d/renewal-risk
```

### Trigger Webhook Event
```bash
curl -X POST http://localhost:3001/api/v1/properties/30214fdb-5381-4d9c-adfe-c59fccb4099d/residents/{residentId}/trigger-event
```

### Test Webhook Delivery
1. Go to https://webhook.site and copy your unique URL
2. Update the RMS endpoint:
   ```bash
   docker exec renewal_risk_db psql -U postgres -d renewal_risk -c \
     "UPDATE rms_endpoints SET endpoint_url = 'YOUR_WEBHOOK_SITE_URL' WHERE property_id = '30214fdb-5381-4d9c-adfe-c59fccb4099d';"
   ```
3. Click "Trigger Event" in the dashboard or use the API
4. Check webhook.site for the delivered payload

## Architecture

```
Frontend (React)          Backend (Express)           Database (PostgreSQL)
     |                           |                           |
     | GET /renewal-risk         |                           |
     |-------------------------->| Query risk scores         |
     |                           |-------------------------->|
     |<--------------------------|<--------------------------|
     |                           |                           |
     | POST /trigger-event       |                           |
     |-------------------------->| Create webhook event      |
     |                           |-------------------------->|
     |                           |                           |
     |                           | POST to RMS endpoint      |
     |                           |-------------------------> External RMS
```

## Risk Scoring Formula

| Factor | Weight | Description |
|--------|--------|-------------|
| Days to Expiry | 40% | ≤30 days = 40pts, ≤45 = 30pts, ≤60 = 20pts, ≤90 = 10pts |
| Payment Delinquency | 25% | Any late fee = 25pts |
| No Renewal Offer | 20% | No offer sent = 20pts |
| Rent Above Market | 15% | Market rent > current rent = 15pts |

**Risk Tiers**: High (70-100), Medium (40-69), Low (0-39)

## Webhook Delivery

- **Retry Logic**: Exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Max Attempts**: 5
- **Dead Letter Queue**: Failed webhooks after 5 attempts
- **Idempotency**: Duplicate triggers within 1 hour return existing event
- **Signing**: HMAC-SHA256 via `X-Webhook-Signature` header

## Design Decisions

See `ai/design.adoc` for detailed architectural decisions including:
- D001: Risk signal data types (boolean vs numeric)
- D006: Month-to-month lease handling (treated as 30 days)
- D009: UUID vs sequential IDs

## Project Structure

```
rr/
├── backend/
│   ├── src/
│   │   ├── api/              # Express route handlers
│   │   ├── db/               # Database connection
│   │   ├── services/         # Business logic
│   │   └── index.ts          # Entry point
│   └── migrations/           # SQL migrations + seed
├── frontend/
│   ├── src/
│   │   ├── components/       # React components
│   │   └── App.tsx
│   └── vite.config.ts
├── ai/                       # Design docs and progress tracking
└── docker-compose.yml
```
