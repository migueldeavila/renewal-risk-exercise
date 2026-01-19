export interface RiskSignals {
  daysToExpiryDays: number;
  paymentHistoryDelinquent: boolean;
  noRenewalOfferYet: boolean;
  rentGrowthAboveMarket: boolean;
}

export interface ResidentRiskFlag {
  residentId: string;
  name: string;
  unitId: string;
  riskScore: number;
  riskTier: 'high' | 'medium' | 'low';
  daysToExpiry: number;
  signals: RiskSignals;
}

export interface RenewalRiskResponse {
  propertyId: string;
  calculatedAt: string;
  totalResidents: number;
  flaggedCount: number;
  riskTiers: {
    high: number;
    medium: number;
    low: number;
  };
  flags: ResidentRiskFlag[];
}
