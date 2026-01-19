# Renewal Risk System Design Decisions

## Table of Contents

- [Overview](#overview)
- [Decision Log](#decision-log)
  - [D001: Risk Signal Data Types](#d001-risk-signal-data-types)
  - [D002: ORM Selection](#d002-orm-selection)
  - [D003: Webhook Queue Storage](#d003-webhook-queue-storage)
  - [D003b: Fire-and-Forget Webhook Delivery](#d003b-fire-and-forget-webhook-delivery)
  - [D004: daysToExpiry Representation](#d004-daystoexpiry-representation)
  - [D005: Multi-tenancy Approach](#d005-multi-tenancy-approach)
  - [D006: Month-to-Month Lease Handling](#d006-month-to-month-lease-handling)
  - [D007: Seed Data Scope](#d007-seed-data-scope)
  - [D008: Seed Data in Migrations](#d008-seed-data-in-migrations)
  - [D009: UUID vs Sequential IDs](#d009-uuid-vs-sequential-ids)
- [Schema Design](#schema-design)
  - [renewal_risk_scores](#renewal_risk_scores)
  - [webhook_events](#webhook_events)
  - [webhook_dlq](#webhook_dlq)
  - [D010: Webhook Signing Secret Storage](#d010-webhook-signing-secret-storage)
- [Future Work & Additional Decisions](#future-work--additional-decisions)
  - [D011: Data Retention and Cleanup Strategy](#d011-data-retention-and-cleanup-strategy)
  - [D012: Logging Strategy](#d012-logging-strategy)
  - [D013: Unit Testing Strategy](#d013-unit-testing-strategy)
  - [D014: Hardcoded Property ID in Frontend](#d014-hardcoded-property-id-in-frontend)
  - [D015: Idempotency Window Duration](#d015-idempotency-window-duration)
  - [D016: Batch Calculation Without Limit](#d016-batch-calculation-without-limit)
  - [D017: Concurrency and Locking Strategy](#d017-concurrency-and-locking-strategy)
  - [D018: Risk Score Storage vs API Response](#d018-risk-score-storage-vs-api-response)
- [Open Questions for Future Consideration](#open-questions-for-future-consideration)

## Overview

This document captures architectural and design decisions made during the implementation of the Renewal Risk Detection System.

## Decision Log

### D001: Risk Signal Data Types

**Date:** 2026-01-18

**Context:**
The `rentGrowthAboveMarket` signal could be stored as:

1. **Boolean** - Simple true/false indicating if market rent exceeds current rent
2. **Numeric (percentage)** - The magnitude of the difference (e.g., 15% above market)
3. **Numeric (absolute)** - The dollar amount difference

**Decision:**
We chose **Boolean** for all risk signals.

**Rationale:**

1. **Consistency with webhook payload** - The problem statement defines the webhook payload with boolean signals:

```json
"signals": {
  "daysToExpiryDays": 45,
  "paymentHistoryDelinquent": false,
  "noRenewalOfferYet": true,
  "rentGrowthAboveMarket": false
}
```

2. **Simplicity** - For a sample exercise, boolean signals are sufficient to demonstrate the concept. The risk scoring formula can still weight the binary signals appropriately.

3. **Extensibility** - The database column could be changed to a numeric type later if more granular data is needed, without changing the webhook contract.

**Trade-off acknowledged:**
A boolean `rentGrowthAboveMarket` loses information about *how much* above market the rent is. A resident whose renewal rent is 5% above market is different from one whose rent is 25% above market. For a production system, we would likely store the percentage and derive the boolean for the webhook payload.

---

### D002: ORM Selection

**Date:** 2026-01-18

**Decision:**
Raw `pg` client (node-postgres) instead of Prisma or TypeORM.

**Rationale:**

1. **Maximum SQL control** - Demonstrates understanding of actual queries being executed
2. **No abstraction overhead** - Direct access to PostgreSQL features
3. **Transparency** - Easier to explain query behavior to evaluators
4. **Simplicity** - No schema sync or migration tool complexity

**Trade-off acknowledged:**
More boilerplate code and no automatic type generation from schema.

---

### D003: Webhook Queue Storage

**Date:** 2026-01-18

**Decision:**
Database-backed webhook queue instead of in-memory queue.

**Rationale:**

1. **Durability** - Webhooks survive server restarts
2. **Debuggability** - Can query webhook state via SQL
3. **Auditability** - Full history of delivery attempts
4. **Simplicity** - No need for Redis or external queue system

**Trade-off acknowledged:**
Higher database load compared to in-memory. For production scale, a dedicated queue (Redis, RabbitMQ, SQS) would be preferred.

---

### D003b: Fire-and-Forget Webhook Delivery

**Date:** 2026-01-18

**Context:**
When a user clicks "Trigger Event", should the API wait for webhook delivery to complete before responding?

**Problem with synchronous delivery:**
If the RMS endpoint is slow or down, the API would block for up to 31 seconds (5 retries with exponential backoff: 1+2+4+8+16 seconds). This creates a terrible user experience.

**Decision:**
Webhook delivery is **fire-and-forget** (asynchronous).

**Implementation:**

```typescript
// Create event record in database
const webhookDbId = await createWebhookEvent(...);

// Fire-and-forget: don't await
processWebhookDeliveryAsync(eventId, webhookDbId, payload, rmsEndpoint)
  .catch(err => console.error(err));

// Return immediately to user
return { success: true, eventId, message: 'Event created. Delivery in progress.' };
```

**Rationale:**

1. **Instant UI feedback** - User sees "Event created" immediately
2. **Decoupled reliability** - Webhook failures don't affect user experience
3. **Background retries** - Retries happen silently without blocking

**Trade-off acknowledged:**
The user doesn't know immediately if delivery succeeded. They can check status via the `/webhook-status` endpoint or see it in the dashboard. For a production system, you might add:

- WebSocket/SSE for real-time status updates
- A dedicated background worker process (not just in-process async)
- A proper job queue (Bull, Agenda, etc.)

---

### D004: daysToExpiry Representation

**Date:** 2026-01-18

**Context:**
The webhook payload shows `daysToExpiryDays` as a number (45), but other signals are boolean.

**Decision:**
Store `days_to_expiry` as INTEGER in the database.

**Rationale:**
This value is inherently numeric and needs to be calculated from `lease_end_date - as_of_date`. Storing it allows historical analysis without recalculation.

---

### D005: Multi-tenancy Approach

**Date:** 2026-01-18

**Decision:**
Row-level multi-tenancy using `property_id` column on all tables.

**Rationale:**

1. **Follows existing schema pattern** - Starter schema already uses this approach
2. **Query simplicity** - All queries filter by property_id
3. **Indexing strategy** - Composite indexes starting with property_id

**Implementation rule:**
Every query MUST include `WHERE property_id = ?` to prevent cross-tenant data leakage.

---

### D006: Month-to-Month Lease Handling

**Date:** 2026-01-18

**Context:**
Month-to-month (MTM) leases don't have a fixed end date in the traditional sense. The `lease_end_date` may be in the past, but the lease auto-renews monthly. How should we calculate `days_to_expiry` for risk scoring?

**Options considered:**

1. **Treat as 0 days** - MTM residents can leave anytime, so treat as highest urgency
2. **Treat as 30 days** - MTM auto-renews monthly, so assume ~30 days notice period
3. **Exclude from risk calculation** - Don't flag MTM residents

**Decision:**
Treat month-to-month leases as **30 days to expiry**.

**Rationale:**

1. **Realistic notice period** - Most MTM agreements require 30 days notice to vacate
2. **Balanced risk** - 30 days puts them in "medium-high" risk, which is appropriate since they *can* leave but aren't immediately departing
3. **Actionable** - Property managers can still reach out with retention offers

**Implementation:**

```typescript
if (lease.lease_type === 'month_to_month') {
  daysToExpiry = 30; // Assume 30-day notice period
} else {
  daysToExpiry = differenceInDays(lease.lease_end_date, asOfDate);
}
```

---

### D007: Seed Data Scope

**Date:** 2026-01-18

**Context:**
The problem statement's seed script provides 4 example scenarios. Should we use these as-is or expand?

**Decision:**
Expand to **15 residents** with varied scenarios.

**Rationale:**

1. **Realistic testing** - 15 residents provides a more realistic dashboard view
2. **Edge case coverage** - More residents allows testing various combinations of risk factors
3. **Matches documentation** - The seed_and_testing.md mentions "15 residents with varied lease situations"

**Scenarios included:**

- 4 original scenarios from problem statement (Jane, John, Alice, Bob)
- Additional residents with varied:
  - Days to expiry (15, 30, 45, 60, 90, 120, 180 days)
  - Payment history (on-time, 1 late, multiple late)
  - Renewal offer status (offered, not offered)
  - Rent vs market (at market, below market, above market)

---

### D008: Seed Data in Migrations

**Date:** 2026-01-18

**Context:**
Conventionally, seed data is kept separate from migrations:

- **Migrations** = schema changes (always run, required)
- **Seed scripts** = sample data (optional, dev/test only)

However, for this exercise, we need to simplify setup for evaluators.

**Decision:**
Include seed data as a migration file (`003_seed_data.sql`).

**Rationale:**

1. **Simplified setup** - Evaluators can run all migrations in sequence without extra steps
2. **Single command** - `psql -f migrations/*.sql` sets up everything
3. **Reproducibility** - Same data on every setup, easier to verify expected behavior
4. **Demo context** - This is a take-home exercise, not a production system

**Trade-off acknowledged:**
In production, you would NOT include seed data in migrations. You'd have separate scripts for dev/test seeding, and migrations would only contain schema changes.

---

### D009: UUID vs Sequential IDs

**Date:** 2026-01-18

**Context:**
The starter schema uses UUIDs (`uuid_generate_v4()`) for all primary keys. Should our new tables follow this pattern or use sequential IDs (`SERIAL`/`BIGSERIAL`)?

**Options considered:**

1. **UUIDs** - Consistent with starter schema
2. **Sequential IDs** - Simpler, smaller, better index performance

**Decision:**
Use **UUIDs** for consistency with the existing schema.

**Rationale:**

1. **Consistency** - Matches the pattern established in the starter schema
2. **Simplicity** - No need to mix ID strategies across tables
3. **Foreign keys** - Our tables reference UUID-based tables (residents, leases, properties)

**Trade-off acknowledged:**
Sequential IDs (`BIGSERIAL`) would likely offer better performance for this use case:

- **Smaller storage** - 8 bytes vs 16 bytes per ID
- **Better B-tree performance** - Sequential inserts cluster naturally; UUIDs are random and cause index page splits
- **Easier debugging** - "Record 42" is more readable than "30214fdb-5381-4d9c-adfe-c59fccb4099d"

Since this is a monolith with a single PostgreSQL database, the distributed-system benefits of UUIDs (client-side generation, no coordination) don't apply. For a production system at scale, sequential IDs should be considered for new tables that don't need to reference the existing UUID-based schema.

---

## Schema Design

### renewal_risk_scores

Stores calculated risk scores at a point in time.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| property_id | UUID | Multi-tenant key |
| resident_id | UUID | FK to residents |
| lease_id | UUID | FK to leases |
| risk_score | INTEGER | 0-100 calculated score |
| risk_tier | VARCHAR(10) | high/medium/low |
| days_to_expiry | INTEGER | Days until lease ends |
| payment_delinquent | BOOLEAN | Has late payments |
| no_renewal_offer | BOOLEAN | No offer sent yet |
| rent_growth_above_market | BOOLEAN | Market rent > current rent |
| calculated_at | TIMESTAMP | When this calculation was done |
| created_at | TIMESTAMP | Row creation time |

**Indexes:**

- `(property_id, calculated_at)` - Get latest risk scores for a property
- `(property_id, risk_tier)` - Filter by risk level

---

### webhook_events

Tracks webhook delivery lifecycle.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| event_id | VARCHAR | Idempotency key (unique) |
| property_id | UUID | Multi-tenant key |
| resident_id | UUID | FK to residents |
| event_type | VARCHAR | Event type (renewal.risk_flagged) |
| payload | JSONB | Full webhook payload |
| status | VARCHAR | pending/processing/delivered/failed |
| attempt_count | INTEGER | Number of delivery attempts |
| last_attempt_at | TIMESTAMP | Last delivery attempt time |
| next_retry_at | TIMESTAMP | When to retry (null if delivered) |
| last_response_code | INTEGER | HTTP status from RMS |
| last_response_body | TEXT | Response body from RMS |
| delivered_at | TIMESTAMP | When successfully delivered |
| created_at | TIMESTAMP | Row creation time |
| updated_at | TIMESTAMP | Last modification time |

**Indexes:**

- `(status, next_retry_at)` - Find webhooks ready for retry
- `(event_id)` - Idempotency check

---

### webhook_dlq

Dead letter queue for failed webhooks.

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| webhook_event_id | UUID | FK to webhook_events |
| failure_reason | TEXT | Why it was moved to DLQ |
| moved_to_dlq_at | TIMESTAMP | When moved to DLQ |

### D010: Webhook Signing Secret Storage

**Date:** 2026-01-18

**Context:**
The webhook signing secret is stored as a plain text string in the `rms_endpoints` table and seeded via `003_seed_data.sql`. This secret is used to compute HMAC-SHA256 signatures for webhook payloads.

**Decision:**
Store the signing secret as **plain text** in the database for this exercise.

**Rationale:**

1. **Simplicity** - For a take-home exercise, avoiding encryption complexity keeps the focus on the core feature
2. **Debuggability** - Evaluators can easily inspect and modify the secret for testing
3. **No key management** - No need to implement key derivation, rotation, or secure storage

**Trade-off acknowledged:**
In production, you would NEVER store signing secrets as plain text. A production implementation should:

- Store secrets encrypted at rest (e.g., using AWS KMS, HashiCorp Vault, or database-level encryption)
- Use environment variables or a secrets manager for the encryption key
- Implement secret rotation with grace periods for old signatures
- Consider asymmetric signing (e.g., RS256) where only the public key is shared with the RMS
- Audit access to the secrets table

---

### D012: Logging Strategy

**Date:** 2026-01-18

**Context:**
Error handling needs to balance two concerns:
1. **User-facing messages** should be generic (avoid leaking internal details)
2. **Backend logs** need full stack traces for debugging

**Decision:**
Implemented a minimal custom logger (`src/utils/logger.ts`) that:
- Logs full stack traces to console on errors
- Includes context (operation name, propertyId, residentId, eventId)
- Timestamps all log entries
- Provides info/warn/error levels

**Example output:**
```
============================================================
[ERROR] 2026-01-18T14:30:00.000Z [calculateRenewalRisk] propertyId=abc-123
Message: relation "renewal_risk_scores" does not exist
Stack trace:
    at Pool.query (...)
    at calculateRenewalRisk (...)
============================================================
```

**Why not a full logging framework (winston, pino)?**
Time constraint. A minimal logger provides the key benefit (stack traces with context) without setup overhead.

**Production improvements:**
- Use structured logging (JSON format) for log aggregation
- Add request correlation IDs for tracing
- Configure log levels via environment variables
- Send logs to aggregation service (DataDog, CloudWatch, etc.)
- Add request/response logging middleware

---

### D013: Unit Testing Strategy

**Date:** 2026-01-18

**Context:**
Adding unit tests to validate core business logic without requiring database connections.

**Decision:**
- Extracted pure scoring functions into `riskScoring.ts` for testability
- Used Jest with ts-jest for TypeScript support
- Focused tests on the risk scoring logic (most critical business logic)

**Test Coverage:**
- `calculateDaysToExpiryScore` - All threshold boundaries
- `calculatePaymentScore` - Boolean logic
- `calculateRenewalOfferScore` - Boolean logic
- `isRentAboveMarket` - Null handling, 5% threshold
- `getRiskTier` - Tier boundaries
- `calculateDaysToExpiry` - Month-to-month handling, expired leases
- `calculateTotalRiskScore` - Integration of all components

**Run tests:**
```bash
npm test           # Run once
npm test:watch     # Watch mode
npm test:coverage  # With coverage report
```

**Why not integration tests?**
Time constraint. Integration tests require database setup/teardown which adds complexity. The pure function unit tests provide good coverage of the core business logic.

**Production improvements:**
- Add integration tests for API endpoints
- Add database integration tests with test containers
- Add end-to-end tests for critical flows
- Set up CI/CD pipeline to run tests on PR

---

### D014: Property ID Configuration

**Date:** 2026-01-18

**Context:**
The frontend needs a property ID to fetch risk data. The property ID is generated dynamically (UUID) when running migrations, so it changes on each fresh setup.

**Decision:**
Auto-fetch the first property from the API as a fallback if no environment variable is set.

**Implementation:**
1. Check for `VITE_PROPERTY_ID` environment variable
2. If not set, call `GET /api/v1/properties` to fetch available properties
3. Use the first property returned
4. Display property name in header

**Rationale:**
- Zero-config setup for evaluators - just run migrations and start servers
- Environment variable still supported for explicit configuration
- Graceful error handling if no properties exist or API is down

**Production improvements:**
- Use React Router for `/properties/:propertyId/renewal-risk`
- Add property selector dropdown for multi-property users
- Derive default property from user authentication context

---

### D015: Idempotency Window Duration

**Date:** 2026-01-18

**Context:**
When a user triggers a webhook event, the system checks for recent events to prevent duplicates. What time window should we use?

**Decision:**
Use a **1-hour idempotency window**. If an event was triggered for the same resident within the last hour, return the existing event instead of creating a new one.

**Rationale:**
- Prevents accidental double-clicks or UI bugs from creating duplicate events
- 1 hour is long enough to catch user mistakes
- Short enough that legitimate re-triggers (e.g., after risk score changes) aren't blocked for too long
- The RMS should also implement idempotency via `eventId`, so this is defense-in-depth

**Trade-off:**
If a property manager legitimately needs to re-trigger an event within 1 hour (e.g., after updating resident data), they must wait. For production, consider making this configurable or adding a "force re-trigger" option for admins.

---

### D016: Batch Calculation Without Limit

**Date:** 2026-01-18

**Context:**
The `POST /calculate` endpoint fetches all residents for a property in a single query to calculate their risk scores. For large properties (5000+ residents), this could cause memory issues or timeouts.

**Current Implementation:**
Single query fetches all residents at once, processes them in memory, then batch-inserts results.

**Decision:**
Leave as-is for the take-home exercise scope.

**Production Improvements:**
- Process residents in batches (e.g., 500 at a time) using LIMIT/OFFSET or cursor-based pagination
- Use streaming/cursor queries to avoid loading all rows into memory
- Consider async job queue (Bull, Agenda) for very large properties
- Add progress tracking for long-running calculations
- Implement cancellation support for stuck jobs

**Example batched approach:**
```typescript
const BATCH_SIZE = 500;
let offset = 0;
let batch;

do {
  batch = await getResidentsBatch(propertyId, asOfDate, BATCH_SIZE, offset);
  const scores = calculateScoresForBatch(batch);
  await saveScoresBatch(scores);
  offset += BATCH_SIZE;
} while (batch.length === BATCH_SIZE);
```

---

### D017: Concurrency and Locking Strategy

**Date:** 2026-01-18

**Context:**
Multiple API requests could trigger concurrent operations:
- Two simultaneous risk calculations for the same property
- Two webhook triggers for the same resident at the same instant
- Webhook retry processing while a new trigger arrives

**Decision:**
No explicit application-level locking. Rely on database constraints and "latest wins" semantics.

**Current Behavior:**

| Scenario | Behavior |
|----------|----------|
| Concurrent risk calculations | Both succeed, insert separate records. GET returns most recent by `calculated_at` |
| Concurrent webhook triggers | `event_id` UNIQUE constraint prevents duplicates. Second insert fails gracefully |
| Transaction isolation | PostgreSQL default `READ COMMITTED` level |
| Batch inserts | Wrapped in transaction for atomicity |

**Why no explicit locking:**
- Simplicity for take-home scope
- Database constraints provide sufficient protection
- No data corruption possible, worst case is duplicate computation
- "Latest wins" is acceptable for this use case

**Production Improvements:**
- Add advisory locks for risk calculations: `SELECT pg_advisory_lock(hashtext(property_id))`
- Use `INSERT ... ON CONFLICT` for idempotent webhook creation
- Consider optimistic locking with version columns for frequently updated records
- Add distributed locking (Redis) if running multiple backend instances
- Use `SELECT ... FOR UPDATE` when reading then updating webhook status

**Example advisory lock:**
```sql
-- Acquire lock before calculation (blocks concurrent calculations for same property)
SELECT pg_advisory_lock(hashtext($1));  -- $1 = property_id

-- ... perform calculation ...

-- Release lock
SELECT pg_advisory_unlock(hashtext($1));
```

---

### D018: Risk Score Storage vs API Response

**Date:** 2026-01-18

**Context:**
When calculating risk scores, should we store all residents or only flagged ones? And what should the API return?

**Decision:**
- **Database:** Store ALL residents (including low risk) for complete audit trail
- **API Response:** Return only flagged residents (medium + high risk) in the `flags` array

**Rationale:**
- Per problem statement: "Store risk scores for each resident" (all)
- Per problem statement output: `flaggedCount` and `flags` suggest filtered response
- Storing all enables historical analysis and trend detection
- Returning only flagged keeps API responses focused and smaller

---

## Open Questions for Future Consideration

1. Should risk scores be versioned or just latest per resident?

---

## Future Work & Additional Decisions

### D011: Data Retention and Cleanup Strategy

**Date:** 2026-01-18

**Context:**
Over time, the following tables will accumulate significant data:
- `renewal_risk_scores` - New records created on every calculation
- `webhook_events` - New records for every triggered event
- `webhook_dlq` - Failed webhooks accumulate until manually addressed

Without cleanup, these tables will grow unbounded, affecting query performance and storage costs.

**Recommended Approach:**

A background job (cron job or scheduled task) should handle data lifecycle management:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Data Retention Strategy                       │
├─────────────────────┬───────────────────────────────────────────┤
│ Table               │ Recommended Policy                        │
├─────────────────────┼───────────────────────────────────────────┤
│ renewal_risk_scores │ Keep latest per resident + 90 days        │
│                     │ historical. Archive older to cold storage │
├─────────────────────┼───────────────────────────────────────────┤
│ webhook_events      │ Keep 30 days for delivered events.        │
│                     │ Keep 90 days for failed events (audit).   │
│                     │ Archive older to cold storage.            │
├─────────────────────┼───────────────────────────────────────────┤
│ webhook_dlq         │ Manual review required before deletion.   │
│                     │ Alert if items older than 7 days exist.   │
└─────────────────────┴───────────────────────────────────────────┘
```

**Implementation Options:**

1. **PostgreSQL pg_cron extension** - Native scheduled jobs within the database
2. **Application-level scheduler** - Node.js cron (node-cron, agenda) running cleanup queries
3. **External scheduler** - Kubernetes CronJob, AWS EventBridge, or CI/CD scheduled pipeline

**Example Cleanup Queries:**

```sql
-- Archive risk scores older than 90 days (keeping latest per resident)
WITH latest_per_resident AS (
  SELECT DISTINCT ON (resident_id) id
  FROM renewal_risk_scores
  ORDER BY resident_id, calculated_at DESC
)
DELETE FROM renewal_risk_scores
WHERE calculated_at < NOW() - INTERVAL '90 days'
  AND id NOT IN (SELECT id FROM latest_per_resident);

-- Archive delivered webhooks older than 30 days
DELETE FROM webhook_events
WHERE status = 'delivered'
  AND delivered_at < NOW() - INTERVAL '30 days';

-- Alert on stale DLQ items (would be a SELECT for monitoring)
SELECT COUNT(*) FROM webhook_dlq
WHERE moved_to_dlq_at < NOW() - INTERVAL '7 days';
```

**Not Implemented Because:**
This is a take-home exercise with a 2-hour limit. Data cleanup is a production concern that would be defined by product requirements (retention policies, compliance needs, storage budgets).

**Production Considerations:**
- Retention policies should be defined by product/legal requirements
- Consider partitioning tables by date for efficient bulk deletes
- Archive to cold storage (S3, GCS) before deletion for compliance
- Monitor table sizes and set alerts for unexpected growth
- DLQ items require human review before deletion - implement a review workflow
