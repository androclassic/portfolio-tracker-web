'use client';
import PortfolioSummaryCard from '@/components/PortfolioSummary';
import HoldingsTable from '@/components/HoldingsTable';
import AllocationPieChart from '@/components/AllocationPieChart';
import AuthGuard from '@/components/AuthGuard';
import DashboardDataProvider, { useDashboardData } from '@/app/DashboardDataProvider';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { HoldingData, PortfolioSummary, getAssetName } from '@/lib/portfolio-utils';
import { getAssetColor } from '@/lib/assets';

export default function OverviewPage() {
  const { portfolios } = usePortfolio();

  // No portfolios → show create-first-portfolio UI (no DashboardDataProvider needed)
  if (portfolios.length === 0) {
    return (
      <AuthGuard redirectTo="/overview">
        <EmptyPortfolioState />
      </AuthGuard>
    );
  }

  return (
    <AuthGuard redirectTo="/overview">
      <DashboardDataProvider>
        <OverviewContent />
      </DashboardDataProvider>
    </AuthGuard>
  );
}

function OverviewContent() {
  const { data: session } = useSession();
  const router = useRouter();
  const { portfolios } = usePortfolio();
  const {
    txs,
    loadingTxs,
    loadingCurr,
    holdings,
    latestPrices,
    latestPricesWithStables,
    historicalPrices,
    pnlData,
  } = useDashboardData();

  // Check if user needs to set up password
  useEffect(() => {
    if (session?.needsPasswordSetup) {
      router.push('/setup-password');
    }
  }, [session, router]);

  // Derive HoldingData[] from dashboard context
  const holdingsData = useMemo((): HoldingData[] => {
    if (!txs || loadingTxs || loadingCurr) return [];

    const btcPrice = latestPrices['BTC'] || 0;

    return Object.entries(holdings)
      .filter(([, quantity]) => quantity > 0)
      .map(([asset, quantity]) => {
        let currentPrice = latestPricesWithStables[asset];

        // Fallback: most recent historical price
        if ((currentPrice === undefined || currentPrice === 0)) {
          const assetPrices = historicalPrices
            .filter(p => p.asset === asset && p.price_usd > 0);
          if (assetPrices.length > 0) {
            assetPrices.sort((a, b) => b.date.localeCompare(a.date));
            currentPrice = assetPrices[0]!.price_usd;
          } else {
            currentPrice = 0;
          }
        }

        const currentValue = quantity * currentPrice;
        const btcValue = btcPrice > 0 ? currentValue / btcPrice : 0;
        const assetPnL = pnlData.assetPnL[asset] || { pnl: 0, pnlPercent: 0, costBasis: 0, currentValue: 0 };

        return {
          asset,
          name: getAssetName(asset),
          quantity,
          currentPrice,
          currentValue,
          btcValue,
          marketCap: 0,
          avgCost: quantity > 0 ? assetPnL.costBasis / quantity : 0,
          costBasis: assetPnL.costBasis,
          pnl: assetPnL.pnl,
          pnlPercent: assetPnL.pnlPercent,
          color: getAssetColor(asset),
        };
      })
      .sort((a, b) => b.currentValue - a.currentValue);
  }, [txs, holdings, latestPricesWithStables, latestPrices, historicalPrices, pnlData.assetPnL, loadingTxs, loadingCurr]);

  // Derive PortfolioSummary from holdings + pnl
  const portfolioSummary = useMemo((): PortfolioSummary => {
    const totalValue = holdingsData.reduce((sum, h) => sum + h.currentValue, 0);
    return {
      totalValue,
      totalPnl: pnlData.totalPnL,
      totalPnlPercent: pnlData.totalPnLPercent,
      assetCount: holdingsData.length,
    };
  }, [holdingsData, pnlData]);

  const isLoading = loadingTxs || loadingCurr;
  const hasError = !txs && !loadingTxs;

  // Prepare allocation data for pie chart
  const allocationData = holdingsData.map(holding => ({
    asset: holding.asset,
    units: holding.quantity,
    value: holding.currentValue,
  }));

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)' }}>Loading portfolio overview...</div>
      </div>
    );
  }

  // Show empty state if portfolios exist but no transactions
  if (!hasError && holdingsData.length === 0 && !isLoading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', fontWeight: 'bold' }}>
            Portfolio Overview
          </h1>
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            Current holdings and performance metrics
          </p>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '40vh',
          padding: '3rem 2rem',
          textAlign: 'center',
          background: 'var(--card)',
          borderRadius: '12px',
          border: '1px solid var(--border)'
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '1rem',
            opacity: 0.6
          }}>
            💰
          </div>
          <h2 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.5rem',
            fontWeight: 'bold'
          }}>
            No transactions yet
          </h2>
          <p style={{
            color: 'var(--muted)',
            margin: '0 0 1.5rem 0',
            maxWidth: '400px'
          }}>
            Start tracking your portfolio by adding your first transaction. You can add buys, sells, deposits, and withdrawals.
          </p>
          <a
            href="/transactions"
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              textDecoration: 'none'
            }}
          >
            <span>➕</span>
            Add Your First Transaction
          </a>
        </div>
      </div>
    );
  }

  // Show error only if there's an actual error (not just empty data)
  if (hasError && portfolios.length > 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--error)' }}>Error loading portfolio data</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', fontWeight: 'bold' }}>
          Portfolio Overview
        </h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Current holdings and performance metrics
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        gap: '2rem',
        marginBottom: '2rem',
        alignItems: 'start',
      }}
        className="overview-top-grid"
      >
        <div>
          <PortfolioSummaryCard summary={portfolioSummary} />
        </div>
        <div>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 'bold' }}>
            Portfolio Allocation
          </h2>
          <AllocationPieChart
            data={allocationData}
            isLoading={isLoading}
            height={320}
          />
        </div>
      </div>

      <HoldingsTable holdings={holdingsData} />
    </div>
  );
}

function EmptyPortfolioState() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const { refresh } = usePortfolio();

  async function handleCreatePortfolio(e: React.FormEvent) {
    e.preventDefault();
    if (!newPortfolioName.trim()) return;
    await fetch('/api/portfolios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newPortfolioName.trim() })
    });
    setNewPortfolioName('');
    setIsCreateModalOpen(false);
    await refresh();
  }

  return (
    <>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        padding: '2rem',
        textAlign: 'center',
        maxWidth: '600px',
        margin: '0 auto'
      }}>
        <div style={{
          fontSize: '4rem',
          marginBottom: '1.5rem',
          opacity: 0.6
        }}>
          📊
        </div>
        <h1 style={{
          margin: '0 0 1rem 0',
          fontSize: '2rem',
          fontWeight: 'bold'
        }}>
          Welcome to Portfolio Tracker
        </h1>
        <p style={{
          color: 'var(--muted)',
          margin: '0 0 2rem 0',
          fontSize: '1.1rem',
          lineHeight: 1.6
        }}>
          Get started by creating your first portfolio. Portfolios help you organize and track your cryptocurrency investments.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => setIsCreateModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '1rem',
            padding: '0.75rem 1.5rem'
          }}
        >
          <span>➕</span>
          Create Your First Portfolio
        </button>
      </div>

      {isCreateModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCreateModalOpen(false);
          }}
        >
          <div className="modal" role="dialog" aria-modal="true">
            <div className="card-header">
              <div className="card-title">
                <h3>Create Portfolio</h3>
              </div>
              <div className="card-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  <span style={{ marginRight: 6 }}>✕</span>
                  Close
                </button>
              </div>
            </div>
            <form onSubmit={handleCreatePortfolio} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
                  Portfolio Name
                </label>
                <input
                  type="text"
                  placeholder="e.g., Main Portfolio, Trading Account"
                  value={newPortfolioName}
                  onChange={(e) => setNewPortfolioName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontSize: '1rem'
                  }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Create Portfolio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
