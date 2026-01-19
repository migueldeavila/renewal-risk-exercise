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
# On Linux/Mac/Git Bash:
docker exec -i renewal_risk_db psql -U postgres -d renewal_risk < backend/migrations/001_starter_schema.sql
docker exec -i renewal_risk_db psql -U postgres -d renewal_risk < backend/migrations/002_renewal_risk_schema.sql
docker exec -i renewal_risk_db psql -U postgres -d renewal_risk < backend/migrations/003_seed_data.sql

# On Windows PowerShell:
Get-Content backend/migrations/001_starter_schema.sql | docker exec -i renewal_risk_db psql -U postgres -d renewal_risk
Get-Content backend/migrations/002_renewal_risk_schema.sql | docker exec -i renewal_risk_db psql -U postgres -d renewal_risk
Get-Content backend/migrations/003_seed_data.sql | docker exec -i renewal_risk_db psql -U postgres -d renewal_risk

# 3. Start backend
cd backend
cp .env.example .env   # On PowerShell: Copy-Item .env.example .env
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

The frontend automatically fetches the first property from the database. No manual configuration needed.

## Testing

First, get the property ID:
```bash
# Get property ID from database
docker exec renewal_risk_db psql -U postgres -d renewal_risk -t -c "SELECT id FROM properties LIMIT 1;"

# Or via API
curl -s http://localhost:3001/api/v1/properties | jq -r '.properties[0].id'
```

Then use it in the commands below (replace `$PROPERTY_ID`):

### Calculate Risk Scores
```bash
curl -X POST http://localhost:3001/api/v1/properties/$PROPERTY_ID/renewal-risk/calculate \
  -H "Content-Type: application/json" \
  -d '{"asOfDate": "2026-01-18"}'
```

### Get Risk Data
```bash
curl http://localhost:3001/api/v1/properties/$PROPERTY_ID/renewal-risk
```

### Trigger Webhook Event
```bash
curl -X POST http://localhost:3001/api/v1/properties/$PROPERTY_ID/residents/{residentId}/trigger-event
```

### Test Webhook Delivery

**Option A: Use the included Mock RMS server** (recommended)

```bash
# Terminal 3: Start mock RMS
cd mock-rms
npm install
npm start

# Update database to point to mock RMS (replace $PROPERTY_ID with your UUID)
docker exec renewal_risk_db psql -U postgres -d renewal_risk -c \
  "UPDATE rms_endpoints SET endpoint_url = 'http://localhost:4000/webhook' WHERE property_id = '$PROPERTY_ID';"
```

The mock server verifies HMAC signatures and logs received webhooks. See `mock-rms/README.md` for details.

**Note:** The signing secret must match between the database (`rms_endpoints.signing_secret`) and the mock server (`SIGNING_SECRET` env var). Both default to `dev-webhook-secret`.

**Option B: Use webhook.site**

1. Go to https://webhook.site and copy your unique URL
2. Update the RMS endpoint (replace `$PROPERTY_ID` with your UUID):
   ```bash
   docker exec renewal_risk_db psql -U postgres -d renewal_risk -c \
     "UPDATE rms_endpoints SET endpoint_url = 'YOUR_WEBHOOK_SITE_URL' WHERE property_id = '$PROPERTY_ID';"
   ```
3. Click "Trigger Event" in the dashboard or use the API
4. Check webhook.site for the delivered payload (note: signature won't be verified)

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

See `docs/design.md` for detailed architectural decisions (D001-D018) including:
- D001: Risk signal data types (boolean vs numeric)
- D006: Month-to-month lease handling (treated as 30 days)
- D009: UUID vs sequential IDs
- D017: Concurrency and locking strategy

## Agentic Development

This project was developed entirely using **Claude Code** powered by **Claude Opus 4.5**.

### What AI Did Well

- **Initial code generation**: The entirety of the backend API, database schema, React dashboard, and unit tests were written by the AI agent
- **Test writing**: Produced comprehensive unit tests (23 tests) covering all risk scoring edge cases
- **Tool utilization**: Efficiently used available tools (file reading, editing, bash commands, grep/glob searches) to navigate and modify the codebase
- **Documentation**: Generated thorough design decision documentation with rationale and trade-offs

### Where Human Guidance Was Needed

- **Tool installation issues**: Required some refinement when setting up dependencies and configuring Jest
- **Webhook timeout bug**: Initially implemented synchronous webhook delivery, which would block the API if the RMS endpoint failed. Needed nudging to implement fire-and-forget async delivery
- **UI feedback**: Since the agent cannot visually interact with the frontend, human feedback was needed to verify the dashboard rendered correctly
- **Implicit decisions**: Some architectural decisions were made implicitly during coding and needed to be explicitly documented after review

### Architectural Discussion Process

1. **Initial groundwork**: The problem statement provided requirements; human created initial design document outline
2. **Human refinement**: Expanded on key architectural decisions (webhook delivery strategy, multi-tenancy approach)
3. **Agent implementation**: AI filled in implementation details, making pragmatic decisions along the way
4. **AI-assisted review**: A separate evaluation pass by the AI agent identified undocumented decisions and potential issues (sorting bug, documentation mismatches)
5. **Collaborative documentation**: Human and AI worked together to document all implicit decisions (D011-D018)

### Tradeoffs

| AI Strength | AI Limitation |
|-------------|---------------|
| Fast iteration on boilerplate code | Cannot verify visual UI correctness |
| Consistent code style | Occasionally makes assumptions that need correction |
| Thorough edge case consideration | May over-engineer if not constrained |
| Good at explaining decisions | Needs explicit prompting to document implicit choices |

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
├── docs/                     # Design docs and progress tracking
└── docker-compose.yml
```
