-- Migration 002: Renewal Risk and Webhook Delivery Schema
-- Purpose: Track risk scores and webhook delivery state
-- Design decisions documented in: ai/design.adoc

-- Renewal Risk Scores
-- Stores calculated risk scores at a point in time for audit trail
CREATE TABLE renewal_risk_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  lease_id UUID NOT NULL REFERENCES leases(id),

  -- Calculated score
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_tier VARCHAR(10) NOT NULL CHECK (risk_tier IN ('high', 'medium', 'low')),

  -- Risk signals (stored for transparency/debugging)
  days_to_expiry INTEGER NOT NULL,
  payment_delinquent BOOLEAN NOT NULL DEFAULT false,
  no_renewal_offer BOOLEAN NOT NULL DEFAULT false,
  rent_growth_above_market BOOLEAN NOT NULL DEFAULT false,

  -- Timestamps
  calculated_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for getting latest risk scores for a property
CREATE INDEX idx_risk_scores_property_calculated
  ON renewal_risk_scores(property_id, calculated_at DESC);

-- Index for filtering by risk tier
CREATE INDEX idx_risk_scores_property_tier
  ON renewal_risk_scores(property_id, risk_tier);

-- Index for resident lookup
CREATE INDEX idx_risk_scores_resident
  ON renewal_risk_scores(resident_id);


-- Webhook Events
-- Tracks the full lifecycle of webhook delivery
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Idempotency key - prevents duplicate event creation
  event_id VARCHAR(100) NOT NULL UNIQUE,

  -- Multi-tenant and reference keys
  property_id UUID NOT NULL REFERENCES properties(id),
  resident_id UUID NOT NULL REFERENCES residents(id),

  -- Event details
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,

  -- Delivery state
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,

  -- Retry tracking
  last_attempt_at TIMESTAMP,
  next_retry_at TIMESTAMP,

  -- Response tracking (for debugging)
  last_response_code INTEGER,
  last_response_body TEXT,

  -- Success tracking
  delivered_at TIMESTAMP,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for finding webhooks ready for retry
-- Efficient query: WHERE status = 'pending' AND next_retry_at <= NOW()
CREATE INDEX idx_webhook_events_retry
  ON webhook_events(status, next_retry_at)
  WHERE status IN ('pending', 'processing');

-- Index for idempotency checks
CREATE INDEX idx_webhook_events_event_id
  ON webhook_events(event_id);

-- Index for property-based queries
CREATE INDEX idx_webhook_events_property
  ON webhook_events(property_id, created_at DESC);


-- Webhook Dead Letter Queue
-- Stores webhooks that failed after max retries
CREATE TABLE webhook_dlq (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_event_id UUID NOT NULL REFERENCES webhook_events(id),
  failure_reason TEXT NOT NULL,
  moved_to_dlq_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for reviewing DLQ by date
CREATE INDEX idx_webhook_dlq_date
  ON webhook_dlq(moved_to_dlq_at DESC);


-- RMS Endpoint Configuration
-- Stores the webhook endpoint URL per property
CREATE TABLE rms_endpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) UNIQUE,
  endpoint_url VARCHAR(500) NOT NULL,
  signing_secret VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rms_endpoints_property
  ON rms_endpoints(property_id);
