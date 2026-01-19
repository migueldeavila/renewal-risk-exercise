-- Seed Data for Renewal Risk System
-- Creates 1 property with 20 units and 15 residents with varied risk scenarios
-- Run after migrations: psql -U postgres -d renewal_risk -f seed.sql

-- Use a single transaction for atomicity
BEGIN;

-- Create property
WITH property_data AS (
  INSERT INTO properties (name, address, city, state, zip_code, status)
  VALUES ('Park Meadows Apartments', '123 Main St', 'Denver', 'CO', '80206', 'active')
  RETURNING id
),

-- Create unit type
unit_type_data AS (
  INSERT INTO unit_types (property_id, name, bedrooms, bathrooms, square_footage)
  SELECT id, '1BR/1BA', 1, 1, 700
  FROM property_data
  RETURNING id, property_id
),

-- Create 20 units
units_data AS (
  INSERT INTO units (property_id, unit_type_id, unit_number, floor, status)
  SELECT
    ut.property_id,
    ut.id,
    (100 + gs.n)::text,
    FLOOR(gs.n / 10) + 1,
    'occupied'
  FROM unit_type_data ut
  CROSS JOIN generate_series(1, 20) AS gs(n)
  RETURNING id, property_id, unit_type_id, unit_number
),

-- Create unit pricing (market rent varies by unit)
unit_pricing_data AS (
  INSERT INTO unit_pricing (unit_id, base_rent, market_rent, effective_date)
  SELECT
    id,
    1500 + (CAST(unit_number AS INT) - 100) * 10,  -- Base rent varies $1510-$1700
    1600,  -- Market rent is $1600 for all
    CURRENT_DATE
  FROM units_data
  RETURNING unit_id
),

-- ============================================
-- SCENARIO 1: Jane Doe - HIGH RISK
-- 45 days to expiry, no renewal offer, on-time payments, rent below market
-- Expected score: ~85
-- ============================================
resident_1 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Jane', 'Doe', 'jane.doe@example.com', 'active', '2023-01-15'
  FROM units_data WHERE unit_number = '101'
  RETURNING id, property_id, unit_id
),
lease_1 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-01-15', CURRENT_DATE + INTERVAL '45 days', 1400, 'fixed', 'active'
  FROM resident_1
  RETURNING id, property_id, resident_id
),
payments_1 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1400, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_1 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 2: John Smith - MEDIUM RISK
-- 60 days to expiry, 1 missed payment, no renewal offer
-- Expected score: ~70
-- ============================================
resident_2 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'John', 'Smith', 'john.smith@example.com', 'active', '2023-01-15'
  FROM units_data WHERE unit_number = '102'
  RETURNING id, property_id, unit_id
),
lease_2 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-01-15', CURRENT_DATE + INTERVAL '60 days', 1500, 'fixed', 'active'
  FROM resident_2
  RETURNING id, property_id, resident_id
),
payments_2 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1500, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_2 r CROSS JOIN generate_series(0, 4) AS gs(n)  -- Only 5 payments (1 missed)
  RETURNING id
),
late_fee_2 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT property_id, id, 'charge', 'late_fee', 50, CURRENT_DATE - INTERVAL '2 months'
  FROM resident_2
  RETURNING id
),

-- ============================================
-- SCENARIO 3: Alice Johnson - LOW RISK
-- 180 days left, renewal offer sent, on-time payments
-- Expected score: ~20
-- ============================================
resident_3 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Alice', 'Johnson', 'alice.johnson@example.com', 'active', '2023-06-15'
  FROM units_data WHERE unit_number = '103'
  RETURNING id, property_id, unit_id
),
lease_3 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-06-15', CURRENT_DATE + INTERVAL '180 days', 1600, 'fixed', 'active'
  FROM resident_3
  RETURNING id, property_id, resident_id
),
payments_3 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1600, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_3 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),
renewal_3 AS (
  INSERT INTO renewal_offers (property_id, resident_id, lease_id, renewal_start_date, renewal_end_date, proposed_rent, status)
  SELECT l.property_id, l.resident_id, l.id, CURRENT_DATE + INTERVAL '180 days', CURRENT_DATE + INTERVAL '545 days', 1650, 'pending'
  FROM lease_3 l
  RETURNING id
),

-- ============================================
-- SCENARIO 4: Bob Williams - MEDIUM RISK (MTM)
-- Month-to-month lease (treated as 30 days), no renewal offer
-- Expected score: ~65
-- ============================================
resident_4 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Bob', 'Williams', 'bob.williams@example.com', 'active', '2024-01-01'
  FROM units_data WHERE unit_number = '104'
  RETURNING id, property_id, unit_id
),
lease_4 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2024-12-01', '2025-01-01', 1450, 'month_to_month', 'active'
  FROM resident_4
  RETURNING id, property_id, resident_id
),
payments_4 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1450, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_4 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 5: Carol Davis - HIGH RISK
-- 30 days to expiry, multiple late payments, no renewal offer, rent below market
-- Expected score: ~90
-- ============================================
resident_5 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Carol', 'Davis', 'carol.davis@example.com', 'active', '2023-03-01'
  FROM units_data WHERE unit_number = '105'
  RETURNING id, property_id, unit_id
),
lease_5 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-03-01', CURRENT_DATE + INTERVAL '30 days', 1350, 'fixed', 'active'
  FROM resident_5
  RETURNING id, property_id, resident_id
),
payments_5 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1350, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_5 r CROSS JOIN generate_series(0, 3) AS gs(n)  -- Only 4 payments (2 missed)
  RETURNING id
),
late_fees_5 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'charge', 'late_fee', 50, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_5 r CROSS JOIN generate_series(1, 2) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 6: David Brown - MEDIUM RISK
-- 75 days to expiry, on-time payments, no renewal offer
-- Expected score: ~55
-- ============================================
resident_6 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'David', 'Brown', 'david.brown@example.com', 'active', '2023-04-01'
  FROM units_data WHERE unit_number = '106'
  RETURNING id, property_id, unit_id
),
lease_6 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-04-01', CURRENT_DATE + INTERVAL '75 days', 1550, 'fixed', 'active'
  FROM resident_6
  RETURNING id, property_id, resident_id
),
payments_6 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1550, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_6 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 7: Emma Wilson - LOW RISK
-- 120 days to expiry, renewal offer sent, on-time payments
-- Expected score: ~15
-- ============================================
resident_7 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Emma', 'Wilson', 'emma.wilson@example.com', 'active', '2023-05-01'
  FROM units_data WHERE unit_number = '107'
  RETURNING id, property_id, unit_id
),
lease_7 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-05-01', CURRENT_DATE + INTERVAL '120 days', 1600, 'fixed', 'active'
  FROM resident_7
  RETURNING id, property_id, resident_id
),
payments_7 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1600, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_7 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),
renewal_7 AS (
  INSERT INTO renewal_offers (property_id, resident_id, lease_id, renewal_start_date, proposed_rent, status)
  SELECT l.property_id, l.resident_id, l.id, CURRENT_DATE + INTERVAL '120 days', 1650, 'pending'
  FROM lease_7 l
  RETURNING id
),

-- ============================================
-- SCENARIO 8: Frank Miller - HIGH RISK
-- 15 days to expiry (CRITICAL), on-time payments, no renewal offer
-- Expected score: ~80
-- ============================================
resident_8 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Frank', 'Miller', 'frank.miller@example.com', 'active', '2023-02-01'
  FROM units_data WHERE unit_number = '108'
  RETURNING id, property_id, unit_id
),
lease_8 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-02-01', CURRENT_DATE + INTERVAL '15 days', 1580, 'fixed', 'active'
  FROM resident_8
  RETURNING id, property_id, resident_id
),
payments_8 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1580, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_8 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 9: Grace Lee - MEDIUM RISK
-- 90 days to expiry, 1 late payment, no renewal offer
-- Expected score: ~50
-- ============================================
resident_9 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Grace', 'Lee', 'grace.lee@example.com', 'active', '2023-06-01'
  FROM units_data WHERE unit_number = '109'
  RETURNING id, property_id, unit_id
),
lease_9 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-06-01', CURRENT_DATE + INTERVAL '90 days', 1520, 'fixed', 'active'
  FROM resident_9
  RETURNING id, property_id, resident_id
),
payments_9 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1520, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_9 r CROSS JOIN generate_series(0, 4) AS gs(n)
  RETURNING id
),
late_fee_9 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT property_id, id, 'charge', 'late_fee', 50, CURRENT_DATE - INTERVAL '3 months'
  FROM resident_9
  RETURNING id
),

-- ============================================
-- SCENARIO 10: Henry Taylor - LOW RISK
-- 150 days to expiry, on-time payments, renewal offer sent
-- Expected score: ~10
-- ============================================
resident_10 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Henry', 'Taylor', 'henry.taylor@example.com', 'active', '2023-07-01'
  FROM units_data WHERE unit_number = '110'
  RETURNING id, property_id, unit_id
),
lease_10 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-07-01', CURRENT_DATE + INTERVAL '150 days', 1600, 'fixed', 'active'
  FROM resident_10
  RETURNING id, property_id, resident_id
),
payments_10 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1600, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_10 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),
renewal_10 AS (
  INSERT INTO renewal_offers (property_id, resident_id, lease_id, renewal_start_date, proposed_rent, status)
  SELECT l.property_id, l.resident_id, l.id, CURRENT_DATE + INTERVAL '150 days', 1650, 'pending'
  FROM lease_10 l
  RETURNING id
),

-- ============================================
-- SCENARIO 11: Ivy Martinez - HIGH RISK
-- 50 days to expiry, rent WAY below market ($1300 vs $1600), no renewal offer
-- Expected score: ~75
-- ============================================
resident_11 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Ivy', 'Martinez', 'ivy.martinez@example.com', 'active', '2022-01-01'
  FROM units_data WHERE unit_number = '111'
  RETURNING id, property_id, unit_id
),
lease_11 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2022-01-01', CURRENT_DATE + INTERVAL '50 days', 1300, 'fixed', 'active'
  FROM resident_11
  RETURNING id, property_id, resident_id
),
payments_11 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1300, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_11 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 12: Jack Anderson - MEDIUM RISK (MTM)
-- Month-to-month, 1 late payment
-- Expected score: ~60
-- ============================================
resident_12 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Jack', 'Anderson', 'jack.anderson@example.com', 'active', '2024-06-01'
  FROM units_data WHERE unit_number = '112'
  RETURNING id, property_id, unit_id
),
lease_12 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2024-06-01', '2024-07-01', 1500, 'month_to_month', 'active'
  FROM resident_12
  RETURNING id, property_id, resident_id
),
payments_12 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1500, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_12 r CROSS JOIN generate_series(0, 4) AS gs(n)
  RETURNING id
),
late_fee_12 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT property_id, id, 'charge', 'late_fee', 50, CURRENT_DATE - INTERVAL '2 months'
  FROM resident_12
  RETURNING id
),

-- ============================================
-- SCENARIO 13: Karen Thomas - LOW RISK
-- 200 days to expiry, renewal offer accepted
-- Expected score: ~5
-- ============================================
resident_13 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Karen', 'Thomas', 'karen.thomas@example.com', 'active', '2023-08-01'
  FROM units_data WHERE unit_number = '113'
  RETURNING id, property_id, unit_id
),
lease_13 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-08-01', CURRENT_DATE + INTERVAL '200 days', 1600, 'fixed', 'active'
  FROM resident_13
  RETURNING id, property_id, resident_id
),
payments_13 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1600, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_13 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),
renewal_13 AS (
  INSERT INTO renewal_offers (property_id, resident_id, lease_id, renewal_start_date, proposed_rent, status)
  SELECT l.property_id, l.resident_id, l.id, CURRENT_DATE + INTERVAL '200 days', 1650, 'accepted'
  FROM lease_13 l
  RETURNING id
),

-- ============================================
-- SCENARIO 14: Leo Garcia - HIGH RISK
-- 25 days to expiry, multiple late payments, no offer, rent below market
-- Expected score: ~95
-- ============================================
resident_14 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Leo', 'Garcia', 'leo.garcia@example.com', 'active', '2023-01-01'
  FROM units_data WHERE unit_number = '114'
  RETURNING id, property_id, unit_id
),
lease_14 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-01-01', CURRENT_DATE + INTERVAL '25 days', 1350, 'fixed', 'active'
  FROM resident_14
  RETURNING id, property_id, resident_id
),
payments_14 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1350, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_14 r CROSS JOIN generate_series(0, 2) AS gs(n)  -- Only 3 payments
  RETURNING id
),
late_fees_14 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'charge', 'late_fee', 50, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_14 r CROSS JOIN generate_series(1, 3) AS gs(n)
  RETURNING id
),

-- ============================================
-- SCENARIO 15: Mia Robinson - MEDIUM RISK
-- 55 days to expiry, on-time payments, no renewal offer, at market rent
-- Expected score: ~45
-- ============================================
resident_15 AS (
  INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status, move_in_date)
  SELECT property_id, id, 'Mia', 'Robinson', 'mia.robinson@example.com', 'active', '2023-09-01'
  FROM units_data WHERE unit_number = '115'
  RETURNING id, property_id, unit_id
),
lease_15 AS (
  INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
  SELECT property_id, id, unit_id, '2023-09-01', CURRENT_DATE + INTERVAL '55 days', 1600, 'fixed', 'active'
  FROM resident_15
  RETURNING id, property_id, resident_id
),
payments_15 AS (
  INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
  SELECT r.property_id, r.id, 'payment', 'rent', 1600, CURRENT_DATE - INTERVAL '1 month' * gs.n
  FROM resident_15 r CROSS JOIN generate_series(0, 5) AS gs(n)
  RETURNING id
),

-- Create RMS endpoint for webhook testing
rms_endpoint AS (
  INSERT INTO rms_endpoints (property_id, endpoint_url, signing_secret, is_active)
  SELECT id, 'https://webhook.site/your-unique-url', 'dev-webhook-secret', true
  FROM property_data
  RETURNING id
)

-- Final select to show property_id for testing
SELECT id as property_id FROM property_data;

COMMIT;

-- After running, verify with:
-- SELECT p.id, p.name,
--   (SELECT COUNT(*) FROM residents WHERE property_id = p.id) as residents,
--   (SELECT COUNT(*) FROM leases WHERE property_id = p.id AND status = 'active') as active_leases
-- FROM properties p;
