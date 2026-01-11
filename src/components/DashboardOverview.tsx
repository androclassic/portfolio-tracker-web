'use client';

import React, { useMemo } from 'react';
import { useDashboardData } from '../app/DashboardDataProvider';
import { isStablecoin } from '@/lib/assets';

export function DashboardOverview() {
  const {
    holdings,
    latestPrices,
    historicalPrices,
    fxRateMap,
    pnlData,
    loadingCurr,
  } = useDashboardData();

  const metrics = useMemo(() => {
    if (loadingCurr || !holdings || !latestPrices) {
      return null;
    }

    let totalValue = 0;
    let totalCost = 0;
    let totalPnl = 0;
    let stablecoinValue = 0;
    let cryptoValue = 0;

    // Helper to get EURC price (EUR/USD rate)
    const getEURCPrice = (): number => {
      if (fxRateMap.size > 0) {
        // Try to get latest EUR/USD rate from any date in fxRateMap
        const dates = Array.from(fxRateMap.keys()).sort().reverse();
        for (const d of dates) {
          const rates = fxRateMap.get(d);
          if (rates && rates['EUR']) {
            return rates['EUR']; // EUR/USD rate
          }
        }
      }
      // Fallback to approximate rate if no FX data available
      return 1.08; // Approximate EUR/USD rate
    };

    for (const [asset, units] of Object.entries(holdings)) {
      const qty = Number(units) || 0;
      if (qty <= 0) continue;

      // Use EUR/USD rate for EURC
      let price = asset.toUpperCase() === 'EURC' 
        ? getEURCPrice()
        : (latestPrices[asset]);
      
      // Fallback: if price is missing or 0, try to get from historicalPrices (most recent)
      if ((price === undefined || price === 0) && asset.toUpperCase() !== 'EURC') {
        const assetPrices = historicalPrices.filter(p => p.asset === asset && p.price_usd != null && p.price_usd > 0);
        if (assetPrices.length > 0) {
          // Sort by date descending and take the most recent price
          assetPrices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
          price = assetPrices[0]!.price_usd || 0;
        } else {
          price = 0;
        }
      }
      
      // Ensure price is always a valid number
      if (price === undefined || price === null || isNaN(price)) {
        price = 0;
      }
      
      const value = qty * price;
      totalValue += value;

      // Calculate cost basis and PnL
      const assetPnl = pnlData?.assetPnL[asset];
      if (assetPnl) {
        totalCost += assetPnl.costBasis || 0;
        totalPnl += assetPnl.pnl || 0;
      }

      // Categorize assets
      if (isStablecoin(asset)) {
        stablecoinValue += value;
      } else {
        cryptoValue += value;
      }
    }

    const totalPnlPercentage = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    return {
      totalValue,
      totalPnl,
      totalPnlPercentage,
      stablecoinValue,
      cryptoValue,
      allocation: cryptoValue > 0 ? (cryptoValue / totalValue) * 100 : 0,
    };
  }, [holdings, latestPrices, historicalPrices, fxRateMap, pnlData, loadingCurr]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercentage = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  if (!metrics) {
    return (
      <div className="dashboard-summary">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="summary-card">
            <div className="skeleton-text" style={{ height: '12px', width: '60px', marginBottom: '8px' }} />
            <div className="skeleton-text" style={{ height: '32px', width: '120px', marginBottom: '8px' }} />
            <div className="skeleton-text" style={{ height: '14px', width: '80px' }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-summary">
      {/* Total Portfolio Value */}
      <div className="summary-card primary">
        <div className="summary-label">Total Portfolio</div>
        <div className="summary-value">{formatCurrency(metrics.totalValue)}</div>
        <div className={`summary-change ${metrics.totalPnl >= 0 ? 'positive' : 'negative'}`}>
          {formatCurrency(metrics.totalPnl)} ({formatPercentage(metrics.totalPnlPercentage)})
        </div>
      </div>

      {/* Crypto Allocation */}
      <div className="summary-card">
        <div className="summary-label">Crypto Assets</div>
        <div className="summary-value">{formatCurrency(metrics.cryptoValue)}</div>
        <div className="summary-subtext">
          {metrics.allocation.toFixed(1)}% of portfolio
        </div>
      </div>

      {/* Stablecoin Holdings */}
      <div className="summary-card">
        <div className="summary-label">Stablecoins</div>
        <div className="summary-value">{formatCurrency(metrics.stablecoinValue)}</div>
        <div className="summary-subtext">
          Low-risk holdings
        </div>
      </div>

      {/* Performance Indicator */}
      <div className="summary-card">
        <div className="summary-label">Performance</div>
        <div className={`summary-value ${metrics.totalPnlPercentage >= 0 ? 'positive' : 'negative'}`}>
          {formatPercentage(metrics.totalPnlPercentage)}
        </div>
        <div className="summary-subtext">
          Total return
        </div>
      </div>
    </div>
  );
}
