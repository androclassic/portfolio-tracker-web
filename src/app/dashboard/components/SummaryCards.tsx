'use client';
import React, { useCallback, useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';

export function SummaryCards() {
  const {
    holdings,
    latestPrices,
    historicalPrices,
    loadingTxs,
    loadingCurr,
    loadingHist,
    pnlData,
    assets,
    fxRateMap,
  } = useDashboardData();

  const isLoading = loadingTxs || loadingCurr || loadingHist;

  const getEURCPriceFn = useCallback(
    (date?: string) => getEURCPrice(fxRateMap, date),
    [fxRateMap]
  );

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const summary = useMemo(() => {
    const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    const nf2 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    let currentValue = 0;
    let dayChange = 0;
    let dayChangePct = 0;

    if (latestPrices && Object.keys(latestPrices).length > 0) {
      for (const [a, units] of Object.entries(holdings)) {
        if (units <= 0) continue;
        let price = latestPrices[a];
        if (price === undefined || price === 0) {
          if (a === 'EURC') {
            price = getEURCPriceFn();
          } else if (isStablecoin(a)) {
            price = 1.0;
          } else {
            price = 0;
          }
        }
        currentValue += price * units;
      }
    }

    if (hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
      const n = dates.length;
      if (n >= 1) {
        const prevDate = dates[n - 1];
        const prevMap = new Map<string, number>();
        for (const p of hist.prices) {
          if (p.date === prevDate) prevMap.set(p.asset.toUpperCase(), p.price_usd);
        }
        for (const [a, units] of Object.entries(holdings)) {
          if (units <= 0 || isStablecoin(a)) continue;
          const cp = latestPrices[a] || 0;
          const pp = prevMap.get(a) ?? cp;
          dayChange += (cp - pp) * units;
        }
        if (currentValue > 0) dayChangePct = (dayChange / (currentValue - dayChange)) * 100;
      }
    }

    const totalPL = pnlData.totalPnL;
    const totalPLPct = pnlData.totalPnLPercent;

    return {
      currentValue,
      dayChange,
      dayChangePct,
      totalPL,
      totalPLPct,
      formattedValue: nf0.format(currentValue),
      formattedChange: nf2.format(Math.abs(dayChange)),
      formattedPL: `${totalPL >= 0 ? '' : '-'}$${nf0.format(Math.abs(totalPL))}`,
    };
  }, [holdings, latestPrices, hist, pnlData, getEURCPriceFn]);

  const allocationData = useMemo(() => {
    return Object.entries(holdings)
      .map(([asset, units]) => {
        let price = latestPrices[asset];
        if (price === undefined || price === 0) {
          if (asset === 'EURC') {
            price = getEURCPriceFn();
          } else if (isStablecoin(asset)) {
            price = 1.0;
          } else {
            const assetPrices = hist.prices.filter(p => p.asset === asset && p.price_usd != null && p.price_usd > 0);
            if (assetPrices.length > 0) {
              assetPrices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              price = assetPrices[0]!.price_usd || 0;
            } else {
              price = 0;
            }
          }
        }
        return { asset, units, value: price * units };
      })
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [holdings, latestPrices, getEURCPriceFn, hist]);

  return (
    <div className="dashboard-summary">
      <div className="summary-card primary">
        <div className="summary-label">Portfolio Value</div>
        <div className="summary-value">
          {isLoading ? (
            <div className="skeleton-text" style={{ width: '120px', height: '32px' }} />
          ) : (
            <>${summary.formattedValue}</>
          )}
        </div>
        {!isLoading && (
          <div className={`summary-change ${summary.dayChange >= 0 ? 'positive' : 'negative'}`}>
            {summary.dayChange >= 0 ? '↑' : '↓'} ${summary.formattedChange} ({summary.dayChangePct >= 0 ? '+' : ''}{summary.dayChangePct.toFixed(2)}%)
          </div>
        )}
      </div>

      <div className="summary-card">
        <div className="summary-label">Total P&L</div>
        <div className={`summary-value ${summary.totalPL >= 0 ? 'positive' : 'negative'}`}>
          {isLoading ? (
            <div className="skeleton-text" style={{ width: '100px', height: '28px' }} />
          ) : (
            <>{summary.formattedPL}</>
          )}
        </div>
        {!isLoading && summary.totalPLPct !== undefined && (
          <div className="summary-subtext">
            {summary.totalPLPct >= 0 ? '+' : ''}{summary.totalPLPct.toFixed(2)}%
          </div>
        )}
      </div>

      <div className="summary-card">
        <div className="summary-label">Assets</div>
        <div className="summary-value">
          {isLoading ? (
            <div className="skeleton-text" style={{ width: '60px', height: '28px' }} />
          ) : (
            <>{assets.length}</>
          )}
        </div>
        <div className="summary-subtext">{allocationData.length} active</div>
      </div>
    </div>
  );
}
