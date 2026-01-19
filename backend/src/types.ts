// API Types for Renewal Risk System

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

export interface CalculateRiskRequest {
  propertyId: string;
  asOfDate: string;
}

// Database row types
export interface ResidentWithLeaseData {
  resident_id: string;
  first_name: string;
  last_name: string;
  unit_id: string;
  unit_number: string;
  lease_id: string;
  lease_end_date: Date;
  lease_type: string;
  monthly_rent: number;
  market_rent: number | null;
  has_late_fee: boolean;
  has_renewal_offer: boolean;
}

// Webhook types
export interface WebhookPayload {
  event: string;
  eventId: string;
  timestamp: string;
  propertyId: string;
  residentId: string;
  data: {
    riskScore: number;
    riskTier: 'high' | 'medium' | 'low';
    daysToExpiry: number;
    signals: RiskSignals;
  };
}
