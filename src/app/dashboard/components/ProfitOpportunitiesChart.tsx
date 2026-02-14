'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataPoints } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import type { Data } from 'plotly.js';

export function ProfitOpportunitiesChart() {
  const { txs, assets, dailyPos, historicalPrices, priceIndex, loadingTxs } = useDashboardData();

  const [selectedProfitAsset, setSelectedProfitAsset] = useAutoSelectAsset(assets, {
    filter: a => a !== 'BTC',
    defaultAsset: 'ADA',
  });

  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);
  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  // Profit-Taking Opportunities
  const profitOpportunities = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], opportunities: {} as Record<string, { altcoinPnL: number[]; btcPnL: number[] }> };
    }

    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    // Use priceIndex.dates if available, otherwise derive from historicalPrices
    const dates = priceIndex.dates.length > 0
      ? priceIndex.dates
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();

    // Group transactions by date for efficient processing
    const txsByDate = new Map<string, typeof txs>();
    for (const tx of txs) {
      const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(txDate) || [];
      arr.push(tx);
      txsByDate.set(txDate, arr);
    }

    // Build position map from dailyPos for quick position lookup
    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }

    // Sort positions by date for each asset
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }

    const opportunities: Record<string, { altcoinPnL: number[]; btcPnL: number[] }> = {};

    for (const asset of assets) {
      if (asset === 'BTC') continue;

      const altcoinPnL: number[] = [];
      const btcPnL: number[] = [];

      // Track cost basis and BTC equivalent over time
        let totalQuantity = 0;
        let totalCostUsd = 0;
      let totalBtcQuantity = 0;
      let totalBtcCostUsd = 0;

      const positions = positionsByAsset.get(asset);
      let positionIdx = 0;

      for (const date of dates) {
        // Process transactions for this date (only once per date)
        const txsForDate = txsByDate.get(date) || [];
        for (const tx of txsForDate) {
          if (tx.type === 'Swap') {
            if (tx.toAsset.toUpperCase() === asset) {
              const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
              const costUsd = quantity * (tx.toPriceUsd || 0);
              totalCostUsd += costUsd;

              // Track BTC equivalent
              const btcPriceAtTx = priceMap.get(date + '|BTC') || priceMap.get(dates[dates.length - 1]! + '|BTC') || 0;
              if (btcPriceAtTx > 0) {
                const btcQty = costUsd / btcPriceAtTx;
                totalBtcQuantity += btcQty;
                totalBtcCostUsd += costUsd;
              }
            } else if (tx.fromAsset?.toUpperCase() === asset) {
              const quantity = Math.abs(tx.fromQuantity || 0);
            if (totalQuantity > 0) {
              const currentAvgCost = totalCostUsd / totalQuantity;
              const unitsToSell = Math.min(quantity, totalQuantity);
              totalCostUsd -= unitsToSell * currentAvgCost;
              totalQuantity -= unitsToSell;

                // Track BTC equivalent sell
              if (totalBtcQuantity > 0) {
                const currentAvgBtcCost = totalBtcCostUsd / totalBtcQuantity;
                  const btcPriceAtTx = priceMap.get(date + '|BTC') || priceMap.get(dates[dates.length - 1]! + '|BTC') || 0;
                  if (btcPriceAtTx > 0) {
                    const costUsd = quantity * (tx.fromPriceUsd || currentAvgCost);
                const btcQuantityToSell = costUsd / btcPriceAtTx;
                    const unitsToSellBtc = Math.min(btcQuantityToSell, totalBtcQuantity);
                    totalBtcCostUsd -= unitsToSellBtc * currentAvgBtcCost;
                    totalBtcQuantity -= unitsToSellBtc;
                  }
                }
              }
            }
          } else if (tx.type === 'Deposit' && tx.toAsset.toUpperCase() === asset) {
            const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
            const costUsd = quantity * (tx.toPriceUsd || 1);
            totalCostUsd += costUsd;

            // Track BTC equivalent
            const btcPriceAtTx = priceMap.get(date + '|BTC') || priceMap.get(dates[dates.length - 1]! + '|BTC') || 0;
            if (btcPriceAtTx > 0) {
              const btcQty = costUsd / btcPriceAtTx;
              totalBtcQuantity += btcQty;
              totalBtcCostUsd += costUsd;
            }
          }
        }

        // Get current position from dailyPos (for validation)
        let currentPosition = 0;
        if (positions && positions.length > 0) {
          while (positionIdx < positions.length - 1 && positions[positionIdx + 1]!.date <= date) {
            positionIdx++;
          }
          if (positions[positionIdx]!.date <= date) {
            currentPosition = positions[positionIdx]!.position;
          }
        }

        // Only calculate PnL if we have a position
        if (currentPosition > 0 || totalQuantity > 0) {
          const currentPrice = priceMap.get(date + '|' + asset) || 0;
          const currentBtcPrice = priceMap.get(date + '|BTC') || 0;
          const currentValueUsd = totalQuantity * currentPrice;
          const altcoinPnLValue = currentValueUsd - totalCostUsd;
          altcoinPnL.push(altcoinPnLValue);

          let btcPnLValue = 0;
          if (totalBtcQuantity > 0 && totalBtcCostUsd > 0 && currentBtcPrice > 0) {
            const currentBtcValueUsd = totalBtcQuantity * currentBtcPrice;
            btcPnLValue = currentBtcValueUsd - totalBtcCostUsd;
          }
          btcPnL.push(btcPnLValue);
        } else {
          altcoinPnL.push(0);
          btcPnL.push(0);
        }
      }

      opportunities[asset] = { altcoinPnL, btcPnL };
    }

    const result = { dates, opportunities };
    return result;
  }, [hist, assets, txs, dailyPos, priceIndex]);

  return (
    <ChartCard
      title="Profit-Taking Opportunities (Altcoin vs BTC PnL)"
      infoText={`Profit-Taking Opportunities

This chart compares your altcoin PnL vs what BTC PnL would be if you had bought Bitcoin instead.

• Solid line = Your altcoin PnL (actual performance)
• Dashed line = BTC PnL (what you would have made with BTC)
• When altcoin line > BTC line = altcoin outperforming BTC
• When BTC line > altcoin line = BTC would have been better
• Only shows comparison when you have an active position

This helps identify when to take profits on altcoins vs holding BTC longer.

Use the asset selector to compare different altcoins.`}
      headerActions={() => (
        <label className="chart-control">
          Asset
          <select value={selectedProfitAsset} onChange={e => setSelectedProfitAsset(e.target.value)}>
            {assets.filter(a => a !== 'BTC').map(a => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      )}
    >
      {({ timeframe, expanded }) => {
        if (loadingTxs || !txs) {
          return <div className="chart-loading">Loading opportunities...</div>;
        }
        if (!profitOpportunities.dates.length) {
          return <div className="chart-empty">No opportunities data</div>;
        }
        const idx = sliceStartIndexForIsoDates(profitOpportunities.dates, timeframe);
        const dates = profitOpportunities.dates.slice(idx);

        // Sample data points for performance (max 100 points)
        const maxPoints = expanded ? 200 : 100;
        const makeAssetTraces = (asset: string) => {
          const altcoinPnL = (profitOpportunities.opportunities[asset]?.altcoinPnL || []).slice(idx);
          const btcPnL = (profitOpportunities.opportunities[asset]?.btcPnL || []).slice(idx);
          const sampled = sampleDataPoints(dates, [altcoinPnL, btcPnL], maxPoints);
          return [
            {
              x: sampled.dates,
              y: sampled.dataArrays[0]!,
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: `${asset} PnL`,
              line: { color: colorFor(asset) },
            },
            {
              x: sampled.dates,
              y: sampled.dataArrays[1]!,
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: 'BTC PnL (if bought instead)',
              line: { color: '#f7931a', dash: 'dash' },
            },
          ];
        };

        const traces = makeAssetTraces(selectedProfitAsset);

        return (
          <Plot
            data={traces as unknown as Data[]}
            layout={{
              autosize: true,
              height: expanded ? undefined : 320,
              margin: { t: 30, r: 10, l: 40, b: 40 },
              legend: { orientation: 'h' },
              yaxis: { title: { text: 'PnL (USD)' } },
              hovermode: 'x unified',
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            style={{ width: '100%', height: expanded ? '100%' : undefined }}
          />
        );
      }}
    </ChartCard>
  );
}
