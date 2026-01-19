import { pool } from '../db';
import {
  ResidentWithLeaseData,
  ResidentRiskFlag,
  RenewalRiskResponse,
  RiskSignals,
} from '../types';

/**
 * Risk Scoring Formula (from problem statement):
 * - Days to lease expiry: 40% weight
 * - Payment delinquency: 25% weight
 * - No renewal offer yet: 20% weight
 * - Rent growth above market: 15% weight
 *
 * See ai/design.adoc for detailed design decisions.
 */

const WEIGHTS = {
  DAYS_TO_EXPIRY: 40,
  PAYMENT_DELINQUENCY: 25,
  NO_RENEWAL_OFFER: 20,
  RENT_ABOVE_MARKET: 15,
};

/**
 * Calculate days-to-expiry score (0-40 points)
 * Fewer days = higher risk
 *
 * Month-to-month leases are treated as 30 days (see D006 in design.adoc)
 */
function calculateDaysToExpiryScore(daysToExpiry: number): number {
  if (daysToExpiry > 90) return 0;
  if (daysToExpiry > 60) return 10;
  if (daysToExpiry > 45) return 20;
  if (daysToExpiry > 30) return 30;
  return WEIGHTS.DAYS_TO_EXPIRY; // 40 points for <= 30 days
}

/**
 * Calculate payment delinquency score (0 or 25 points)
 * Any late fee = delinquent
 */
function calculatePaymentScore(hasLateFee: boolean): number {
  return hasLateFee ? WEIGHTS.PAYMENT_DELINQUENCY : 0;
}

/**
 * Calculate renewal offer score (0 or 20 points)
 * No offer = higher risk
 */
function calculateRenewalOfferScore(hasRenewalOffer: boolean): number {
  return hasRenewalOffer ? 0 : WEIGHTS.NO_RENEWAL_OFFER;
}

/**
 * Calculate rent growth score (0 or 15 points)
 * Market rent > current rent = higher risk (they may leave for cheaper)
 */
function calculateRentGrowthScore(
  monthlyRent: number,
  marketRent: number | null
): boolean {
  if (marketRent === null) return false;
  // If market rent is more than 5% above current rent, flag it
  return marketRent > monthlyRent * 1.05;
}

/**
 * Determine risk tier from score
 */
function getRiskTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Calculate days to expiry, handling month-to-month leases
 */
function calculateDaysToExpiry(
  leaseEndDate: Date,
  leaseType: string,
  asOfDate: Date
): number {
  // Month-to-month: treat as 30 days (see D006)
  if (leaseType === 'month_to_month') {
    return 30;
  }

  const diffTime = leaseEndDate.getTime() - asOfDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // If lease already expired, return 0
  return Math.max(0, diffDays);
}

/**
 * Query residents with all data needed for risk calculation
 */
async function getResidentsWithLeaseData(
  propertyId: string,
  asOfDate: Date
): Promise<ResidentWithLeaseData[]> {
  const query = `
    SELECT
      r.id as resident_id,
      r.first_name,
      r.last_name,
      r.unit_id,
      u.unit_number,
      l.id as lease_id,
      l.lease_end_date,
      l.lease_type,
      l.monthly_rent,
      -- Get most recent market rent for the unit
      (
        SELECT up.market_rent
        FROM unit_pricing up
        WHERE up.unit_id = r.unit_id
          AND up.effective_date <= $2
        ORDER BY up.effective_date DESC
        LIMIT 1
      ) as market_rent,
      -- Check for any late fees (indicates payment delinquency)
      EXISTS (
        SELECT 1 FROM resident_ledger rl
        WHERE rl.resident_id = r.id
          AND rl.charge_code = 'late_fee'
      ) as has_late_fee,
      -- Check if renewal offer exists
      EXISTS (
        SELECT 1 FROM renewal_offers ro
        WHERE ro.resident_id = r.id
          AND ro.lease_id = l.id
      ) as has_renewal_offer
    FROM residents r
    JOIN leases l ON l.resident_id = r.id AND l.property_id = r.property_id
    JOIN units u ON u.id = r.unit_id
    WHERE r.property_id = $1
      AND r.status = 'active'
      AND l.status = 'active'
    ORDER BY l.lease_end_date ASC
  `;

  const result = await pool.query(query, [propertyId, asOfDate]);
  return result.rows;
}

/**
 * Save risk scores to database
 */
async function saveRiskScores(
  propertyId: string,
  calculatedAt: Date,
  flags: ResidentRiskFlag[],
  residentsData: Map<string, ResidentWithLeaseData>
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const flag of flags) {
      const residentData = residentsData.get(flag.residentId);
      if (!residentData) continue;

      await client.query(
        `INSERT INTO renewal_risk_scores (
          property_id, resident_id, lease_id,
          risk_score, risk_tier,
          days_to_expiry, payment_delinquent, no_renewal_offer, rent_growth_above_market,
          calculated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          propertyId,
          flag.residentId,
          residentData.lease_id,
          flag.riskScore,
          flag.riskTier,
          flag.daysToExpiry,
          flag.signals.paymentHistoryDelinquent,
          flag.signals.noRenewalOfferYet,
          flag.signals.rentGrowthAboveMarket,
          calculatedAt,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Main function: Calculate renewal risk for all residents in a property
 */
export async function calculateRenewalRisk(
  propertyId: string,
  asOfDateStr: string
): Promise<RenewalRiskResponse> {
  const asOfDate = new Date(asOfDateStr);
  const calculatedAt = new Date();

  // Get all residents with their lease data
  const residents = await getResidentsWithLeaseData(propertyId, asOfDate);

  if (residents.length === 0) {
    return {
      propertyId,
      calculatedAt: calculatedAt.toISOString(),
      totalResidents: 0,
      flaggedCount: 0,
      riskTiers: { high: 0, medium: 0, low: 0 },
      flags: [],
    };
  }

  // Calculate risk for each resident
  const flags: ResidentRiskFlag[] = [];
  const residentsDataMap = new Map<string, ResidentWithLeaseData>();

  for (const resident of residents) {
    residentsDataMap.set(resident.resident_id, resident);

    const daysToExpiry = calculateDaysToExpiry(
      new Date(resident.lease_end_date),
      resident.lease_type,
      asOfDate
    );

    const rentAboveMarket = calculateRentGrowthScore(
      Number(resident.monthly_rent),
      resident.market_rent ? Number(resident.market_rent) : null
    );

    // Calculate component scores
    const daysScore = calculateDaysToExpiryScore(daysToExpiry);
    const paymentScore = calculatePaymentScore(resident.has_late_fee);
    const renewalScore = calculateRenewalOfferScore(resident.has_renewal_offer);
    const rentScore = rentAboveMarket ? WEIGHTS.RENT_ABOVE_MARKET : 0;

    // Total score (max 100)
    const riskScore = Math.min(
      100,
      daysScore + paymentScore + renewalScore + rentScore
    );
    const riskTier = getRiskTier(riskScore);

    const signals: RiskSignals = {
      daysToExpiryDays: daysToExpiry,
      paymentHistoryDelinquent: resident.has_late_fee,
      noRenewalOfferYet: !resident.has_renewal_offer,
      rentGrowthAboveMarket: rentAboveMarket,
    };

    flags.push({
      residentId: resident.resident_id,
      name: `${resident.first_name} ${resident.last_name}`,
      unitId: resident.unit_number,
      riskScore,
      riskTier,
      daysToExpiry,
      signals,
    });
  }

  // Sort by risk score descending
  flags.sort((a, b) => b.riskScore - a.riskTier.localeCompare(a.riskTier));
  flags.sort((a, b) => b.riskScore - a.riskScore);

  // Count by tier
  const riskTiers = {
    high: flags.filter((f) => f.riskTier === 'high').length,
    medium: flags.filter((f) => f.riskTier === 'medium').length,
    low: flags.filter((f) => f.riskTier === 'low').length,
  };

  // Only include flagged residents (medium or high risk) in response
  const flaggedResidents = flags.filter((f) => f.riskTier !== 'low');

  // Save to database
  await saveRiskScores(propertyId, calculatedAt, flags, residentsDataMap);

  return {
    propertyId,
    calculatedAt: calculatedAt.toISOString(),
    totalResidents: residents.length,
    flaggedCount: flaggedResidents.length,
    riskTiers,
    flags: flaggedResidents,
  };
}
