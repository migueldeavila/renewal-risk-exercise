import { Router, Request, Response } from 'express';
import { calculateRenewalRisk } from '../services/riskCalculation';
import { triggerRenewalEvent, getWebhookStatus } from '../services/webhookDelivery';
import { pool } from '../db';

const router = Router();

/**
 * POST /api/v1/properties/:propertyId/renewal-risk/calculate
 *
 * Triggers renewal risk calculation for a property.
 * Returns summary of residents flagged with risk scores.
 */
router.post(
  '/properties/:propertyId/renewal-risk/calculate',
  async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.params;
      const { asOfDate } = req.body;

      // Validate propertyId format (UUID)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(propertyId)) {
        return res.status(400).json({
          error: 'Invalid propertyId format. Expected UUID.',
        });
      }

      // Validate asOfDate
      if (!asOfDate) {
        return res.status(400).json({
          error: 'asOfDate is required in request body.',
        });
      }

      const parsedDate = new Date(asOfDate);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          error: 'Invalid asOfDate format. Expected ISO date string.',
        });
      }

      // Verify property exists
      const propertyCheck = await pool.query(
        'SELECT id FROM properties WHERE id = $1',
        [propertyId]
      );

      if (propertyCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Property not found.',
        });
      }

      // Calculate risk
      const result = await calculateRenewalRisk(propertyId, asOfDate);

      return res.json(result);
    } catch (error) {
      console.error('Error calculating renewal risk:', error);
      return res.status(500).json({
        error: 'Internal server error while calculating renewal risk.',
      });
    }
  }
);

/**
 * GET /api/v1/properties/:propertyId/renewal-risk
 *
 * Gets the most recent risk calculation results for a property.
 *
 * Query params:
 *   - page: Page number (1-indexed, default: 1)
 *   - pageSize: Results per page (default: 10, max: 100)
 *   - tier: Filter by risk tier ('all', 'high', 'medium', 'low', default: 'all')
 *   - sortBy: Sort field ('riskScore', 'daysToExpiry', 'name', default: 'riskScore')
 *   - sortOrder: Sort direction ('asc', 'desc', default: 'desc')
 */
router.get(
  '/properties/:propertyId/renewal-risk',
  async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.params;

      // Parse and validate query params
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 10));
      const tierFilter = (req.query.tier as string) || 'all';
      const sortBy = (req.query.sortBy as string) || 'riskScore';
      const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'ASC' : 'DESC';

      // Validate propertyId format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(propertyId)) {
        return res.status(400).json({
          error: 'Invalid propertyId format. Expected UUID.',
        });
      }

      // Validate tier filter
      const validTiers = ['all', 'high', 'medium', 'low'];
      if (!validTiers.includes(tierFilter)) {
        return res.status(400).json({
          error: `Invalid tier filter. Expected one of: ${validTiers.join(', ')}`,
        });
      }

      // Map sortBy to database column
      const sortColumnMap: Record<string, string> = {
        riskScore: 'rrs.risk_score',
        daysToExpiry: 'rrs.days_to_expiry',
        name: 'r.last_name',
      };
      const sortColumn = sortColumnMap[sortBy] || 'rrs.risk_score';

      // Get the most recent calculation timestamp
      const latestCalc = await pool.query(
        `SELECT DISTINCT calculated_at
         FROM renewal_risk_scores
         WHERE property_id = $1
         ORDER BY calculated_at DESC
         LIMIT 1`,
        [propertyId]
      );

      if (latestCalc.rows.length === 0) {
        return res.status(404).json({
          error:
            'No risk calculations found for this property. Run POST /renewal-risk/calculate first.',
        });
      }

      const calculatedAt = latestCalc.rows[0].calculated_at;

      // Build tier condition
      let tierCondition = '';
      const queryParams: (string | Date)[] = [propertyId, calculatedAt];

      if (tierFilter !== 'all') {
        tierCondition = ` AND rrs.risk_tier = $3`;
        queryParams.push(tierFilter);
      }

      // Get total count for pagination (respecting tier filter)
      const countResult = await pool.query(
        `SELECT COUNT(*) as total
         FROM renewal_risk_scores rrs
         WHERE rrs.property_id = $1
           AND rrs.calculated_at = $2${tierCondition}`,
        queryParams
      );
      const totalFiltered = parseInt(countResult.rows[0].total);

      // Calculate offset
      const offset = (page - 1) * pageSize;

      // Get paginated risk scores
      const paginationParams = [...queryParams, pageSize, offset];
      const risksResult = await pool.query(
        `SELECT
          rrs.resident_id,
          r.first_name,
          r.last_name,
          u.unit_number,
          rrs.risk_score,
          rrs.risk_tier,
          rrs.days_to_expiry,
          rrs.payment_delinquent,
          rrs.no_renewal_offer,
          rrs.rent_growth_above_market
         FROM renewal_risk_scores rrs
         JOIN residents r ON r.id = rrs.resident_id
         JOIN units u ON u.id = r.unit_id
         WHERE rrs.property_id = $1
           AND rrs.calculated_at = $2${tierCondition}
         ORDER BY ${sortColumn} ${sortOrder}
         LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`,
        paginationParams
      );

      // Transform to API response format
      const flags = risksResult.rows.map((row) => ({
        residentId: row.resident_id,
        name: `${row.first_name} ${row.last_name}`,
        unitId: row.unit_number,
        riskScore: row.risk_score,
        riskTier: row.risk_tier,
        daysToExpiry: row.days_to_expiry,
        signals: {
          daysToExpiryDays: row.days_to_expiry,
          paymentHistoryDelinquent: row.payment_delinquent,
          noRenewalOfferYet: row.no_renewal_offer,
          rentGrowthAboveMarket: row.rent_growth_above_market,
        },
      }));

      // Get total counts per tier (for summary cards)
      const tierCountsResult = await pool.query(
        `SELECT risk_tier, COUNT(*) as count
         FROM renewal_risk_scores
         WHERE property_id = $1 AND calculated_at = $2
         GROUP BY risk_tier`,
        [propertyId, calculatedAt]
      );

      const riskTiers = { high: 0, medium: 0, low: 0 };
      for (const row of tierCountsResult.rows) {
        if (row.risk_tier in riskTiers) {
          riskTiers[row.risk_tier as keyof typeof riskTiers] = parseInt(row.count);
        }
      }

      const totalResidents = riskTiers.high + riskTiers.medium + riskTiers.low;
      const totalPages = Math.ceil(totalFiltered / pageSize);

      return res.json({
        propertyId,
        calculatedAt: calculatedAt.toISOString(),
        totalResidents,
        flaggedCount: riskTiers.high + riskTiers.medium,
        riskTiers,
        flags,
        pagination: {
          page,
          pageSize,
          totalItems: totalFiltered,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    } catch (error) {
      console.error('Error fetching renewal risk:', error);
      return res.status(500).json({
        error: 'Internal server error while fetching renewal risk.',
      });
    }
  }
);

/**
 * POST /api/v1/properties/:propertyId/residents/:residentId/trigger-event
 *
 * Triggers a renewal risk webhook event for a specific resident.
 * The webhook will be delivered to the configured RMS endpoint.
 */
router.post(
  '/properties/:propertyId/residents/:residentId/trigger-event',
  async (req: Request, res: Response) => {
    try {
      const { propertyId, residentId } = req.params;

      // Validate UUID formats
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(propertyId) || !uuidRegex.test(residentId)) {
        return res.status(400).json({
          error: 'Invalid UUID format for propertyId or residentId.',
        });
      }

      // Get the resident's latest risk score
      const riskResult = await pool.query(
        `SELECT risk_score, risk_tier, days_to_expiry,
                payment_delinquent, no_renewal_offer, rent_growth_above_market
         FROM renewal_risk_scores
         WHERE property_id = $1 AND resident_id = $2
         ORDER BY calculated_at DESC
         LIMIT 1`,
        [propertyId, residentId]
      );

      if (riskResult.rows.length === 0) {
        return res.status(404).json({
          error: 'No risk score found for this resident. Run risk calculation first.',
        });
      }

      const risk = riskResult.rows[0];

      // Trigger the webhook
      const result = await triggerRenewalEvent(propertyId, residentId, {
        riskScore: risk.risk_score,
        riskTier: risk.risk_tier,
        daysToExpiry: risk.days_to_expiry,
        signals: {
          daysToExpiryDays: risk.days_to_expiry,
          paymentHistoryDelinquent: risk.payment_delinquent,
          noRenewalOfferYet: risk.no_renewal_offer,
          rentGrowthAboveMarket: risk.rent_growth_above_market,
        },
      });

      if (result.alreadyExists) {
        return res.status(200).json({
          message: result.message,
          eventId: result.eventId,
          alreadyExists: true,
        });
      }

      if (result.success) {
        return res.status(201).json({
          message: result.message,
          eventId: result.eventId,
        });
      } else {
        return res.status(502).json({
          error: result.message,
          eventId: result.eventId,
        });
      }
    } catch (error) {
      console.error('Error triggering renewal event:', error);
      return res.status(500).json({
        error: 'Internal server error while triggering renewal event.',
      });
    }
  }
);

/**
 * GET /api/v1/properties/:propertyId/residents/:residentId/webhook-status
 *
 * Gets the webhook delivery status for a resident.
 */
router.get(
  '/properties/:propertyId/residents/:residentId/webhook-status',
  async (req: Request, res: Response) => {
    try {
      const { propertyId, residentId } = req.params;

      const status = await getWebhookStatus(propertyId, residentId);

      if (!status) {
        return res.status(404).json({
          error: 'No webhook events found for this resident.',
        });
      }

      return res.json(status);
    } catch (error) {
      console.error('Error fetching webhook status:', error);
      return res.status(500).json({
        error: 'Internal server error while fetching webhook status.',
      });
    }
  }
);

export default router;
