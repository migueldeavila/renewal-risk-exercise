# Key Concepts for the Exercise

## 1. Multi-Tenancy

**What it is:** A software architecture where a single instance serves multiple customers (tenants), with data isolation between them.

**In this project:** Each `property_id` represents a tenant. All data (leases, risk scores, webhooks) is partitioned by property_id.

**Why it matters:**
- Queries must always filter by property_id
- Prevents data leakage between tenants
- Enables scaling by distributing tenants across resources

```sql
-- Good: Always include tenant filter
SELECT * FROM leases WHERE property_id = 'prop_123' AND ...

-- Bad: Missing tenant filter (security risk!)
SELECT * FROM leases WHERE lease_id = 'lease_456'
```

---

## 2. Webhook Delivery

**What it is:** Server-to-server HTTP callbacks that notify external systems when events occur.

**Key components:**
- **Event**: Something happened (e.g., "lease approaching expiry")
- **Payload**: JSON data describing the event
- **Endpoint**: URL where the webhook is sent
- **Signing**: HMAC signature to prove authenticity

**Retry with Exponential Backoff:**
```
Attempt 1: Wait 1 second
Attempt 2: Wait 2 seconds
Attempt 3: Wait 4 seconds
Attempt 4: Wait 8 seconds
Attempt 5: Wait 16 seconds
Then: Move to Dead Letter Queue (DLQ)
```

---

## 3. Idempotency

**What it is:** An operation that produces the same result even if executed multiple times.

**Why it matters for webhooks:**
- Network failures may cause retries
- The receiving system might get the same webhook twice
- Without idempotency, you could process the same event multiple times

**Solution:** Include a unique `event_id` in each webhook. The receiver stores processed IDs and ignores duplicates.

```json
{
  "event_id": "evt_abc123",  // Unique identifier
  "event_type": "renewal_risk.high",
  "data": { ... }
}
```

---

## 4. Dead Letter Queue (DLQ)

**What it is:** A holding area for messages/webhooks that failed delivery after all retries.

**Purpose:**
- Prevents losing important data
- Allows manual investigation
- Can be retried later when the issue is resolved

**In this project:** Webhooks that fail 5 times go to a DLQ table for later review.

---

## 5. ACID Transactions

**ACID stands for:**
- **Atomicity**: All operations succeed or all fail
- **Consistency**: Database remains in valid state
- **Isolation**: Concurrent transactions don't interfere
- **Durability**: Committed data survives crashes

**Example in this project:**
```typescript
// Creating a lease and its initial risk assessment should be atomic
await db.transaction(async (tx) => {
  const lease = await tx.insert(leases).values({...});
  await tx.insert(riskAssessments).values({ leaseId: lease.id, ... });
});
// If risk assessment fails, lease is also rolled back
```

---

## 6. N+1 Query Problem

**What it is:** Making N additional queries for N records, instead of fetching all data in one query.

**Bad example (N+1):**
```typescript
const leases = await db.query('SELECT * FROM leases');  // 1 query
for (const lease of leases) {
  // N queries - one for each lease!
  const tenant = await db.query('SELECT * FROM tenants WHERE id = ?', lease.tenantId);
}
```

**Good example (JOIN or IN):**
```typescript
// 1 query with JOIN
const leasesWithTenants = await db.query(`
  SELECT l.*, t.* FROM leases l
  JOIN tenants t ON l.tenant_id = t.id
`);
```

---

## 7. Race Conditions

**What it is:** When the outcome depends on the timing of concurrent operations.

**Example problem:**
```
User A reads balance: $100
User B reads balance: $100
User A withdraws $50, writes: $50
User B withdraws $50, writes: $50
Result: $50 (should be $0!)
```

**Solutions:**
- Database locks (`SELECT ... FOR UPDATE`)
- Optimistic locking (version numbers)
- Atomic operations

---

## 8. REST API Conventions

| HTTP Method | Purpose | Example |
|-------------|---------|---------|
| GET | Read data | `GET /api/renewal-risk` |
| POST | Create resource | `POST /api/events` |
| PUT | Replace resource | `PUT /api/leases/123` |
| PATCH | Partial update | `PATCH /api/leases/123` |
| DELETE | Remove resource | `DELETE /api/leases/123` |

**Status codes:**
- 200: Success
- 201: Created
- 400: Bad request (client error)
- 401: Unauthorized
- 404: Not found
- 500: Server error

---

## 9. TypeScript Interfaces vs Types

**Interface:** Defines a contract for object shapes. Can be extended.
```typescript
interface Lease {
  id: string;
  tenantName: string;
  endDate: Date;
}
```

**Type:** More flexible, can represent unions, primitives, etc.
```typescript
type RiskLevel = 'low' | 'medium' | 'high';
type LeaseOrNull = Lease | null;
```

**Rule of thumb:** Use `interface` for objects, `type` for everything else.

---

## 10. React Hooks

**useState:** Local component state
```typescript
const [loading, setLoading] = useState(false);
```

**useEffect:** Side effects (API calls, subscriptions)
```typescript
useEffect(() => {
  fetchData();
}, []); // Empty array = run once on mount
```

**Common pattern for API calls:**
```typescript
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  fetch('/api/data')
    .then(res => res.json())
    .then(setData)
    .catch(setError)
    .finally(() => setLoading(false));
}, []);
```

---

## 11. Renewal Risk Scoring Formula

**The 4 Risk Factors:**

| Factor | Weight | Max Points | Description |
|--------|--------|------------|-------------|
| Days to lease expiry | 40% | 40 | Fewer days = higher risk |
| Payment delinquency | 25% | 25 | Late/missed payments |
| No renewal offer yet | 20% | 20 | Binary: offered or not |
| Rent growth above market | 15% | 15 | Market rent >> current rent |

**Calculation Example:**
```
Resident with:
- 45 days to expiry → 36/40 points (90% of 40)
- No delinquency → 0/25 points
- No renewal offer → 20/20 points
- Rent below market → 15/15 points

Raw total: 36 + 0 + 20 + 15 = 71 points
Normalized to 0-100: 71/100 = 71
```

**Risk Tiers:**
- **High (70-100)**: Immediate attention required
- **Medium (40-69)**: Monitor closely
- **Low (0-39)**: Standard follow-up

**Days to Expiry Scoring (40 points max):**
```typescript
// More days = less risk
if (daysToExpiry > 90) return 0;        // No risk
if (daysToExpiry > 60) return 10;       // Low risk
if (daysToExpiry > 45) return 20;       // Medium risk
if (daysToExpiry > 30) return 30;       // High risk
return 40;                               // Critical
```

---

## Questions to Consider

As we build this project, think about:

1. What happens if the webhook endpoint is down for hours?
2. How do we ensure a webhook isn't processed twice?
3. Why do we need to sign webhooks?
4. What should happen if the database transaction fails mid-way?
5. How do we prevent one property from seeing another property's data?
