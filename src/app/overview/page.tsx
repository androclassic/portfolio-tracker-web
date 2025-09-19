'use client';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import PortfolioSummary from '@/components/PortfolioSummary';
import HoldingsTable from '@/components/HoldingsTable';
import AllocationPieChart from '@/components/AllocationPieChart';
import AuthGuard from '@/components/AuthGuard';

export default function OverviewPage() {
  const { holdingsData, portfolioSummary, isLoading, hasError } = usePortfolioData();
  
  // Prepare allocation data for pie chart
  const allocationData = holdingsData.map(holding => ({
    asset: holding.asset,
    units: holding.quantity,
    value: holding.currentValue
  }));

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)' }}>Loading portfolio overview...</div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--error)' }}>Error loading portfolio data</div>
      </div>
    );
  }

  return (
    <AuthGuard redirectTo="/overview">
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', fontWeight: 'bold' }}>
          Portfolio Overview
        </h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Current holdings and performance metrics
        </p>
      </div>

              <PortfolioSummary summary={portfolioSummary} />
              
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.5rem', fontWeight: 'bold' }}>
                  Portfolio Allocation
                </h2>
                <AllocationPieChart 
                  data={allocationData}
                  isLoading={isLoading}
                  height={400}
                />
              </div>
              
              <HoldingsTable holdings={holdingsData} />
    </div>
    </AuthGuard>
  );
}