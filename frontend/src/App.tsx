import { useState, useEffect } from 'react';
import RenewalRiskDashboard from './components/RenewalRiskDashboard';

// Property ID from environment variable, or fetched from API as fallback
const ENV_PROPERTY_ID = import.meta.env.VITE_PROPERTY_ID || '';

interface Property {
  id: string;
  name: string;
  address: string;
}

function App() {
  const [propertyId, setPropertyId] = useState<string>(ENV_PROPERTY_ID);
  const [propertyName, setPropertyName] = useState<string>('');
  const [loading, setLoading] = useState(!ENV_PROPERTY_ID);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If property ID is set via env, no need to fetch
    if (ENV_PROPERTY_ID) {
      return;
    }

    // Fetch first property from API as fallback
    async function fetchProperty() {
      try {
        const response = await fetch('/api/v1/properties');
        if (!response.ok) throw new Error('Failed to fetch properties');

        const data = await response.json();
        if (data.properties && data.properties.length > 0) {
          const property: Property = data.properties[0];
          setPropertyId(property.id);
          setPropertyName(property.name);
        } else {
          setError('No properties found. Run migrations and seed data first.');
        }
      } catch (err) {
        setError('Failed to connect to API. Is the backend running?');
      } finally {
        setLoading(false);
      }
    }

    fetchProperty();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || !propertyId) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-red-800 font-medium mb-2">Setup Required</h2>
          <p className="text-red-600 text-sm">{error || 'No property ID configured.'}</p>
          <p className="text-red-600 text-sm mt-2">
            See README.md for setup instructions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">
            Residential Operating Platform
          </h1>
          <p className="text-sm text-gray-500">{propertyName || 'Property Dashboard'}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <RenewalRiskDashboard propertyId={propertyId} />
      </main>
    </div>
  );
}

export default App;
