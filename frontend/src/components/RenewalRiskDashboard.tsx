import { useState, useEffect, useCallback } from 'react';
import { RenewalRiskResponse, ResidentRiskFlag, RiskTierFilter, SortField, SortOrder } from '../types';

interface Props {
  propertyId: string;
}

function RiskBadge({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  const colors = {
    high: 'bg-red-100 text-red-800 border-red-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-green-100 text-green-800 border-green-200',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded border ${colors[tier]}`}>
      {tier.toUpperCase()}
    </span>
  );
}

function SignalsPanel({ signals, isExpanded }: { signals: ResidentRiskFlag['signals']; isExpanded: boolean }) {
  if (!isExpanded) return null;

  const signalItems = [
    { label: 'Days to Expiry', value: signals.daysToExpiryDays, isRisk: signals.daysToExpiryDays <= 60 },
    { label: 'Payment Delinquent', value: signals.paymentHistoryDelinquent ? 'Yes' : 'No', isRisk: signals.paymentHistoryDelinquent },
    { label: 'No Renewal Offer', value: signals.noRenewalOfferYet ? 'Yes' : 'No', isRisk: signals.noRenewalOfferYet },
    { label: 'Rent Above Market', value: signals.rentGrowthAboveMarket ? 'Yes' : 'No', isRisk: signals.rentGrowthAboveMarket },
  ];

  return (
    <tr>
      <td colSpan={6} className="px-6 py-4 bg-gray-50">
        <div className="text-sm">
          <h4 className="font-medium text-gray-700 mb-2">Risk Signals</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {signalItems.map((item) => (
              <div key={item.label} className="flex flex-col">
                <span className="text-gray-500 text-xs">{item.label}</span>
                <span className={`font-medium ${item.isRisk ? 'text-red-600' : 'text-gray-900'}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  );
}

function ResidentRow({ resident, propertyId }: { resident: ResidentRiskFlag; propertyId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [triggerMessage, setTriggerMessage] = useState('');

  const handleTrigger = async () => {
    setTriggerStatus('loading');
    try {
      const response = await fetch(
        `/api/v1/properties/${propertyId}/residents/${resident.residentId}/trigger-event`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const data = await response.json();

      if (response.ok) {
        setTriggerStatus('success');
        setTriggerMessage(data.alreadyExists ? 'Already triggered' : 'Event sent');
      } else {
        setTriggerStatus('error');
        setTriggerMessage(data.error || 'Failed');
      }
    } catch {
      setTriggerStatus('error');
      setTriggerMessage('Network error');
    }

    // Reset after 3 seconds
    setTimeout(() => {
      setTriggerStatus('idle');
      setTriggerMessage('');
    }, 3000);
  };

  return (
    <>
      <tr className="hover:bg-gray-50 border-b">
        <td className="px-6 py-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        </td>
        <td className="px-6 py-4 font-medium text-gray-900">{resident.name}</td>
        <td className="px-6 py-4 text-gray-600">{resident.unitId}</td>
        <td className="px-6 py-4 text-gray-600">{resident.daysToExpiry}</td>
        <td className="px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="font-medium">{resident.riskScore}</span>
            <RiskBadge tier={resident.riskTier} />
          </div>
        </td>
        <td className="px-6 py-4">
          {triggerStatus === 'idle' && (
            <button
              onClick={handleTrigger}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Trigger Event
            </button>
          )}
          {triggerStatus === 'loading' && (
            <span className="text-gray-500 text-sm">Sending...</span>
          )}
          {triggerStatus === 'success' && (
            <span className="text-green-600 text-sm">{triggerMessage}</span>
          )}
          {triggerStatus === 'error' && (
            <span className="text-red-600 text-sm">{triggerMessage}</span>
          )}
        </td>
      </tr>
      <SignalsPanel signals={resident.signals} isExpanded={isExpanded} />
    </>
  );
}

export default function RenewalRiskDashboard({ propertyId }: Props) {
  const [data, setData] = useState<RenewalRiskResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  // Pagination and filtering state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [tierFilter, setTierFilter] = useState<RiskTierFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('riskScore');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const fetchRiskData = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        tier: tierFilter,
        sortBy,
        sortOrder,
      });
      const response = await fetch(`/api/v1/properties/${propertyId}/renewal-risk?${params}`);
      if (response.status === 404) {
        // No calculations yet - that's OK
        setData(null);
        setError(null);
      } else if (!response.ok) {
        throw new Error('Failed to fetch risk data');
      } else {
        const result = await response.json();
        setData(result);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [propertyId, page, pageSize, tierFilter, sortBy, sortOrder]);

  const runCalculation = async () => {
    setCalculating(true);
    try {
      const response = await fetch(
        `/api/v1/properties/${propertyId}/renewal-risk/calculate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asOfDate: new Date().toISOString().split('T')[0] }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to calculate risk');
      }

      // Reset to page 1 and refetch after calculation
      setPage(1);
      await fetchRiskData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calculation failed');
    } finally {
      setCalculating(false);
    }
  };

  useEffect(() => {
    fetchRiskData();
  }, [fetchRiskData]);

  // Reset to page 1 when filters change
  const handleTierFilterChange = (newTier: RiskTierFilter) => {
    setTierFilter(newTier);
    setPage(1);
  };

  const handleSortChange = (field: SortField) => {
    if (sortBy === field) {
      // Toggle order if same field
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium">Error</h3>
        <p className="text-red-600">{error}</p>
        <button
          onClick={fetchRiskData}
          className="mt-2 text-sm text-red-700 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Renewal Risk Dashboard</h2>
          {data && (
            <p className="text-sm text-gray-500">
              Last calculated: {new Date(data.calculatedAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={runCalculation}
          disabled={calculating}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {calculating ? 'Calculating...' : 'Recalculate Risk'}
        </button>
      </div>

      {/* Summary Cards - Clickable filters */}
      {data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <button
            onClick={() => handleTierFilterChange('all')}
            className={`rounded-lg border p-4 text-left transition-all ${
              tierFilter === 'all'
                ? 'bg-gray-100 border-gray-400 ring-2 ring-gray-400'
                : 'bg-white hover:bg-gray-50'
            }`}
          >
            <div className="text-2xl font-bold text-gray-800">{data.totalResidents}</div>
            <div className="text-sm text-gray-500">Total Residents</div>
          </button>
          <button
            onClick={() => handleTierFilterChange('high')}
            className={`rounded-lg border p-4 text-left transition-all ${
              tierFilter === 'high'
                ? 'bg-red-100 border-red-400 ring-2 ring-red-400'
                : 'bg-red-50 border-red-200 hover:bg-red-100'
            }`}
          >
            <div className="text-2xl font-bold text-red-600">{data.riskTiers.high}</div>
            <div className="text-sm text-red-500">High Risk</div>
          </button>
          <button
            onClick={() => handleTierFilterChange('medium')}
            className={`rounded-lg border p-4 text-left transition-all ${
              tierFilter === 'medium'
                ? 'bg-yellow-100 border-yellow-400 ring-2 ring-yellow-400'
                : 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100'
            }`}
          >
            <div className="text-2xl font-bold text-yellow-600">{data.riskTiers.medium}</div>
            <div className="text-sm text-yellow-500">Medium Risk</div>
          </button>
          <button
            onClick={() => handleTierFilterChange('low')}
            className={`rounded-lg border p-4 text-left transition-all ${
              tierFilter === 'low'
                ? 'bg-green-100 border-green-400 ring-2 ring-green-400'
                : 'bg-green-50 border-green-200 hover:bg-green-100'
            }`}
          >
            <div className="text-2xl font-bold text-green-600">{data.riskTiers.low}</div>
            <div className="text-sm text-green-500">Low Risk</div>
          </button>
        </div>
      )}

      {/* No data state */}
      {!data && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-600 mb-4">No risk calculations yet for this property.</p>
          <button
            onClick={runCalculation}
            disabled={calculating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {calculating ? 'Calculating...' : 'Run First Calculation'}
          </button>
        </div>
      )}

      {/* Risk Table */}
      {data && data.flags.length > 0 && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <button
                    onClick={() => handleSortChange('name')}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Resident
                    {sortBy === 'name' && (
                      <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <button
                    onClick={() => handleSortChange('daysToExpiry')}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Days to Expiry
                    {sortBy === 'daysToExpiry' && (
                      <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <button
                    onClick={() => handleSortChange('riskScore')}
                    className="flex items-center gap-1 hover:text-gray-700"
                  >
                    Risk Score
                    {sortBy === 'riskScore' && (
                      <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </button>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.flags.map((resident) => (
                <ResidentRow
                  key={resident.residentId}
                  resident={resident}
                  propertyId={propertyId}
                />
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {data.pagination && (
            <div className="bg-gray-50 border-t px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">
                  Showing {((data.pagination.page - 1) * data.pagination.pageSize) + 1} to{' '}
                  {Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.totalItems)} of{' '}
                  {data.pagination.totalItems} results
                </span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value={5}>5 per page</option>
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(1)}
                  disabled={!data.pagination.hasPrevPage}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  First
                </button>
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={!data.pagination.hasPrevPage}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Prev
                </button>
                <span className="text-sm text-gray-600 px-2">
                  Page {data.pagination.page} of {data.pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={!data.pagination.hasNextPage}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(data.pagination!.totalPages)}
                  disabled={!data.pagination.hasNextPage}
                  className="px-3 py-1 text-sm border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {data && data.flags.length === 0 && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          {tierFilter !== 'all' ? (
            <>
              <p className="text-gray-600 mb-2">No {tierFilter} risk residents found.</p>
              <button
                onClick={() => handleTierFilterChange('all')}
                className="text-sm text-blue-600 hover:underline"
              >
                Show all residents
              </button>
            </>
          ) : (
            <p className="text-green-700">No residents flagged as at-risk.</p>
          )}
        </div>
      )}
    </div>
  );
}
