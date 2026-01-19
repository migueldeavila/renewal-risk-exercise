import RenewalRiskDashboard from './components/RenewalRiskDashboard';

// Default property ID from seed data
// In a real app, this would come from routing or user selection
const PROPERTY_ID = '30214fdb-5381-4d9c-adfe-c59fccb4099d';

function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">
            Residential Operating Platform
          </h1>
          <p className="text-sm text-gray-500">Park Meadows Apartments</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <RenewalRiskDashboard propertyId={PROPERTY_ID} />
      </main>
    </div>
  );
}

export default App;
