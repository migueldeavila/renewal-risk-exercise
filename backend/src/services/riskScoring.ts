/**
 * Pure functions for risk score calculation.
 * Extracted for testability - no database dependencies.
 *
 * Risk Scoring Formula (from problem statement):
 * - Days to lease expiry: 40% weight
 * - Payment delinquency: 25% weight
 * - No renewal offer yet: 20% weight
 * - Rent growth above market: 15% weight
 */

export const WEIGHTS = {
  DAYS_TO_EXPIRY: 40,
  PAYMENT_DELINQUENCY: 25,
  NO_RENEWAL_OFFER: 20,
  RENT_ABOVE_MARKET: 15,
};

/**
 * Calculate days-to-expiry score (0-40 points)
 * Fewer days = higher risk
 */
export function calculateDaysToExpiryScore(daysToExpiry: number): number {
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
export function calculatePaymentScore(hasLateFee: boolean): number {
  return hasLateFee ? WEIGHTS.PAYMENT_DELINQUENCY : 0;
}

/**
 * Calculate renewal offer score (0 or 20 points)
 * No offer = higher risk
 */
export function calculateRenewalOfferScore(hasRenewalOffer: boolean): number {
  return hasRenewalOffer ? 0 : WEIGHTS.NO_RENEWAL_OFFER;
}

/**
 * Determine if rent is above market threshold
 * Returns true if market rent > current rent * 1.05 (5% threshold)
 */
export function isRentAboveMarket(
  monthlyRent: number,
  marketRent: number | null
): boolean {
  if (marketRent === null) return false;
  return marketRent > monthlyRent * 1.05;
}

/**
 * Determine risk tier from score
 */
export function getRiskTier(score: number): 'high' | 'medium' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Calculate days to expiry, handling month-to-month leases
 * Month-to-month: treated as 30 days (see D006 in design.md)
 */
export function calculateDaysToExpiry(
  leaseEndDate: Date,
  leaseType: string,
  asOfDate: Date
): number {
  if (leaseType === 'month_to_month') {
    return 30;
  }

  const diffTime = leaseEndDate.getTime() - asOfDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
}

/**
 * Calculate total risk score from individual components
 */
export function calculateTotalRiskScore(
  daysToExpiry: number,
  hasLateFee: boolean,
  hasRenewalOffer: boolean,
  monthlyRent: number,
  marketRent: number | null
): { score: number; tier: 'high' | 'medium' | 'low'; rentAboveMarket: boolean } {
  const daysScore = calculateDaysToExpiryScore(daysToExpiry);
  const paymentScore = calculatePaymentScore(hasLateFee);
  const renewalScore = calculateRenewalOfferScore(hasRenewalOffer);
  const rentAboveMarket = isRentAboveMarket(monthlyRent, marketRent);
  const rentScore = rentAboveMarket ? WEIGHTS.RENT_ABOVE_MARKET : 0;

  const score = Math.min(100, daysScore + paymentScore + renewalScore + rentScore);
  const tier = getRiskTier(score);

  return { score, tier, rentAboveMarket };
}
