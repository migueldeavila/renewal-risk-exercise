# Project Progress & Status

## Current Phase: COMPLETE

### Environment Setup
- [x] Node.js v22.20.0 installed
- [x] npm 10.9.3 installed
- [x] Git 2.37.1 installed
- [x] PostgreSQL 17.6 installed (local service stopped, using Docker)
- [x] curl 7.84.0 installed
- [x] Docker Desktop 4.56.0 installed
- [x] WSL installed

### Project Structure
- [x] Create backend folder structure
- [x] Create frontend folder structure
- [x] Create docker-compose.yml
- [x] Create root README.md

### Backend Development
- [x] Initialize Node.js/TypeScript project
- [x] Set up Express.js server
- [x] Set up database connection (pg Pool)
- [x] Design database schema (documented in ai/design.adoc)
- [x] Create database migrations
- [x] Implement POST /renewal-risk/calculate endpoint
- [x] Implement GET /renewal-risk endpoint
- [x] Implement risk scoring logic (4 factors)
- [x] Implement webhook delivery with retry (exponential backoff)
- [x] Implement Dead Letter Queue
- [x] Implement idempotency checks
- [x] Implement HMAC signing

### Frontend Development
- [x] Initialize React/TypeScript project (Vite)
- [x] Configure Tailwind CSS
- [x] Create RenewalRiskDashboard component
- [x] Implement API integration
- [x] Add loading/error states
- [x] Add expandable rows for signals
- [x] Add "Trigger Event" button

### Testing & Documentation
- [x] Test API endpoints with curl
- [x] Test webhook delivery
- [x] Write backend README
- [x] Write frontend README
- [x] Write root README

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-18 | Raw pg client | Maximum control over SQL |
| 2026-01-18 | Database-backed webhook queue | Survives restarts, easier debugging |
| 2026-01-18 | Vite for React | Faster than CRA |
| 2026-01-18 | Tailwind CSS | Rapid styling |
| 2026-01-18 | MTM = 30 days | Reasonable notice period assumption |
| 2026-01-18 | Seed in migrations | Simplified setup for evaluators |
| 2026-01-18 | UUIDs for IDs | Consistency with starter schema |

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | /api/v1/properties/:id/renewal-risk/calculate | Calculate risk scores |
| GET | /api/v1/properties/:id/renewal-risk | Get latest risk data |
| POST | /api/v1/properties/:id/residents/:id/trigger-event | Trigger webhook |
| GET | /api/v1/properties/:id/residents/:id/webhook-status | Get webhook status |

---

## Running the Application

```bash
# Terminal 1: Database
docker-compose up -d

# Terminal 2: Backend
cd backend && npm run dev

# Terminal 3: Frontend
cd frontend && npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Property ID: 30214fdb-5381-4d9c-adfe-c59fccb4099d
