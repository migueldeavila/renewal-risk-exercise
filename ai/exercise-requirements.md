# Exercise Requirements Summary

## Software & Tools Status (Windows)

### All Required Tools Installed
| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | v22.20.0 | JavaScript runtime for backend and frontend |
| npm | 10.9.3 | Package manager |
| Git | 2.37.1 | Version control & GitHub submission |
| PostgreSQL | 17.6 | Database (psql CLI available) |
| curl | 7.84.0 | API testing |
| Docker Desktop | 4.56.0 | Container orchestration for docker-compose |
| WSL | (installed) | Required by Docker Desktop for Linux containers |

**Status:** ✅ All tools ready. Docker Desktop is installed and operational.

### Optional Tools
- **GitHub CLI (gh)** - `winget install GitHub.cli` - Easier PR/repo management
- **Postman** - GUI alternative for API testing
- **VS Code** - Recommended editor with TypeScript support

---

## Key Skills Required

### 1. Database Design & SQL (Critical - 15% of evaluation)
- PostgreSQL schema design
- Multi-tenant data modeling (partitioning by property_id)
- Writing efficient queries with proper indexing
- Understanding ACID semantics for atomic operations
- Creating SQL migrations
- Avoiding N+1 query problems

### 2. Backend Development - Node.js/TypeScript (Critical - 45% of evaluation)
- **REST API Design**
  - Express.js (or similar framework like Fastify)
  - Route handling and middleware
  - Request validation
  - Error handling and HTTP status codes

- **TypeScript Proficiency**
  - Type definitions
  - Interfaces for API contracts
  - Strict type checking

- **ORM/Database Access**
  - TypeORM, Prisma, or raw pg client
  - Query building and optimization
  - Transaction management

### 3. Webhook Delivery System (Critical - 20% of evaluation)
- Retry logic with exponential backoff (1s, 2s, 4s, 8s, 16s)
- Idempotency patterns (preventing duplicate deliveries)
- Dead-letter queue (DLQ) implementation
- Request signing for webhook authenticity
- Background job processing (async delivery)

### 4. Frontend Development - React/TypeScript (25% of evaluation)
- React functional components with hooks
- State management (useState, useEffect)
- API integration (fetch or axios)
- Loading and error state handling
- Basic table display with expandable rows
- Minimal styling (Tailwind, CSS, or styled-components)

### 5. System Design Concepts
- Multi-tenancy patterns
- Batch job design (sync vs async)
- Concurrent request handling
- Race condition prevention
- Event-driven architecture

### 6. DevOps Basics
- Docker and docker-compose for local development
- Environment variable configuration
- Database seeding scripts
- README documentation

---

## Architecture Overview

```
Frontend (React)          Backend (Node.js/Express)         Database (PostgreSQL)
     |                           |                                |
     |  GET /renewal-risk        |                                |
     |-------------------------->|  Query risk scores             |
     |                           |------------------------------->|
     |                           |<-------------------------------|
     |<--------------------------|                                |
     |                           |                                |
     |  POST trigger-event       |                                |
     |-------------------------->|  Create webhook event          |
     |                           |------------------------------->|
     |                           |                                |
     |                           |  POST webhook to RMS           |
     |                           |------------------------------> External RMS
     |                           |                                |
```

---

## File Structure to Create

```
rr/
├── backend/
│   ├── src/
│   │   ├── api/           # Route handlers
│   │   ├── schema/        # TypeORM/Prisma models or SQL
│   │   ├── services/      # Business logic (risk calculation)
│   │   ├── webhooks/      # Webhook delivery logic
│   │   └── index.ts       # Entry point
│   ├── migrations/        # Database migrations
│   ├── package.json
│   └── README.md
├── frontend/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page components
│   │   └── App.tsx
│   ├── package.json
│   └── README.md
├── docker-compose.yml     # PostgreSQL + app services
└── README.md              # Root instructions
```

---

## Environment Ready

All required tools are installed:
- Node.js v22.20.0
- npm 10.9.3
- Git 2.37.1
- PostgreSQL 17.6
- curl 7.84.0
- Docker Desktop 4.56.0
- WSL (Windows Subsystem for Linux)

**Status:** ✅ Environment fully configured and ready for development.

---

## Testing Tools (No Install Required)

- **webhook.site** - Free online webhook testing (https://webhook.site)
  - Use to verify webhook delivery without setting up a local RMS

---

## Time Allocation Suggestion (2 hours)

| Task | Time |
|------|------|
| Schema design & migrations | 20 min |
| Renewal risk API endpoint | 25 min |
| Risk calculation logic | 15 min |
| Webhook delivery system | 25 min |
| React dashboard | 20 min |
| Testing & debugging | 10 min |
| Documentation | 5 min |
