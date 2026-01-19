import {
  WEIGHTS,
  calculateDaysToExpiryScore,
  calculatePaymentScore,
  calculateRenewalOfferScore,
  isRentAboveMarket,
  getRiskTier,
  calculateDaysToExpiry,
  calculateTotalRiskScore,
} from './riskScoring';

describe('Risk Scoring Functions', () => {
  describe('calculateDaysToExpiryScore', () => {
    it('returns 40 points for <= 30 days', () => {
      expect(calculateDaysToExpiryScore(30)).toBe(40);
      expect(calculateDaysToExpiryScore(15)).toBe(40);
      expect(calculateDaysToExpiryScore(0)).toBe(40);
    });

    it('returns 30 points for 31-45 days', () => {
      expect(calculateDaysToExpiryScore(31)).toBe(30);
      expect(calculateDaysToExpiryScore(45)).toBe(30);
    });

    it('returns 20 points for 46-60 days', () => {
      expect(calculateDaysToExpiryScore(46)).toBe(20);
      expect(calculateDaysToExpiryScore(60)).toBe(20);
    });

    it('returns 10 points for 61-90 days', () => {
      expect(calculateDaysToExpiryScore(61)).toBe(10);
      expect(calculateDaysToExpiryScore(90)).toBe(10);
    });

    it('returns 0 points for > 90 days', () => {
      expect(calculateDaysToExpiryScore(91)).toBe(0);
      expect(calculateDaysToExpiryScore(180)).toBe(0);
    });
  });

  describe('calculatePaymentScore', () => {
    it('returns 25 points if has late fee', () => {
      expect(calculatePaymentScore(true)).toBe(WEIGHTS.PAYMENT_DELINQUENCY);
    });

    it('returns 0 points if no late fee', () => {
      expect(calculatePaymentScore(false)).toBe(0);
    });
  });

  describe('calculateRenewalOfferScore', () => {
    it('returns 0 points if has renewal offer', () => {
      expect(calculateRenewalOfferScore(true)).toBe(0);
    });

    it('returns 20 points if no renewal offer', () => {
      expect(calculateRenewalOfferScore(false)).toBe(WEIGHTS.NO_RENEWAL_OFFER);
    });
  });

  describe('isRentAboveMarket', () => {
    it('returns false if market rent is null', () => {
      expect(isRentAboveMarket(1500, null)).toBe(false);
    });

    it('returns false if market rent is at or below 5% threshold', () => {
      expect(isRentAboveMarket(1500, 1500)).toBe(false); // at market
      expect(isRentAboveMarket(1500, 1575)).toBe(false); // exactly 5%
      expect(isRentAboveMarket(1500, 1400)).toBe(false); // below market
    });

    it('returns true if market rent is above 5% threshold', () => {
      expect(isRentAboveMarket(1500, 1576)).toBe(true); // just over 5%
      expect(isRentAboveMarket(1500, 1800)).toBe(true); // well above
    });
  });

  describe('getRiskTier', () => {
    it('returns "high" for scores >= 70', () => {
      expect(getRiskTier(70)).toBe('high');
      expect(getRiskTier(85)).toBe('high');
      expect(getRiskTier(100)).toBe('high');
    });

    it('returns "medium" for scores 40-69', () => {
      expect(getRiskTier(40)).toBe('medium');
      expect(getRiskTier(55)).toBe('medium');
      expect(getRiskTier(69)).toBe('medium');
    });

    it('returns "low" for scores < 40', () => {
      expect(getRiskTier(0)).toBe('low');
      expect(getRiskTier(20)).toBe('low');
      expect(getRiskTier(39)).toBe('low');
    });
  });

  describe('calculateDaysToExpiry', () => {
    const asOfDate = new Date('2026-01-18');

    it('returns 30 for month-to-month leases regardless of end date', () => {
      const pastDate = new Date('2025-01-01');
      const futureDate = new Date('2027-01-01');

      expect(calculateDaysToExpiry(pastDate, 'month_to_month', asOfDate)).toBe(30);
      expect(calculateDaysToExpiry(futureDate, 'month_to_month', asOfDate)).toBe(30);
    });

    it('calculates correct days for fixed-term leases', () => {
      const endDate = new Date('2026-03-04'); // 45 days from Jan 18
      expect(calculateDaysToExpiry(endDate, 'fixed', asOfDate)).toBe(45);
    });

    it('returns 0 for expired fixed-term leases', () => {
      const pastDate = new Date('2026-01-01'); // already expired
      expect(calculateDaysToExpiry(pastDate, 'fixed', asOfDate)).toBe(0);
    });
  });

  describe('calculateTotalRiskScore', () => {
    it('calculates high risk scenario correctly', () => {
      // 30 days (40pts) + late fee (25pts) + no offer (20pts) + above market (15pts) = 100
      const result = calculateTotalRiskScore(30, true, false, 1500, 1800);
      expect(result.score).toBe(100);
      expect(result.tier).toBe('high');
      expect(result.rentAboveMarket).toBe(true);
    });

    it('calculates medium risk scenario correctly', () => {
      // 60 days (20pts) + no late fee (0pts) + no offer (20pts) + at market (0pts) = 40
      const result = calculateTotalRiskScore(60, false, false, 1500, 1500);
      expect(result.score).toBe(40);
      expect(result.tier).toBe('medium');
      expect(result.rentAboveMarket).toBe(false);
    });

    it('calculates low risk scenario correctly', () => {
      // 120 days (0pts) + no late fee (0pts) + has offer (0pts) + below market (0pts) = 0
      const result = calculateTotalRiskScore(120, false, true, 1500, 1400);
      expect(result.score).toBe(0);
      expect(result.tier).toBe('low');
      expect(result.rentAboveMarket).toBe(false);
    });

    it('caps score at 100', () => {
      // Even if calculated > 100, should cap
      const result = calculateTotalRiskScore(0, true, false, 1500, 1800);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('handles null market rent', () => {
      const result = calculateTotalRiskScore(45, false, false, 1500, null);
      expect(result.rentAboveMarket).toBe(false);
      // 45 days (30pts) + no late fee (0pts) + no offer (20pts) = 50
      expect(result.score).toBe(50);
      expect(result.tier).toBe('medium');
    });
  });
});
