import { useMemo, useState, useEffect } from 'react';
import useSWR from 'swr';
import { usePortfolio } from '../app/PortfolioProvider';
import { jsonFetcher } from '@/lib/swr-fetcher';
import { usePriceData } from './usePriceData';
import { usePnLCalculation } from './usePnLCalculation';
import { 
  HoldingData, 
  PortfolioSummary, 
  calculateHoldings, 
  getAssetName 
} from '@/lib/portfolio-utils';
import { getAssetColor } from '@/lib/assets';
import { getHistoricalExchangeRate } from '@/lib/exchange-rates';
import type { Transaction as Tx } from '@/lib/types';

export function usePortfolioData() {
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  
  // Fetch transactions
  const { data: txs, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, jsonFetcher);
  
  // Get all unique assets from transactions
  const allAssets = useMemo(() => {
    if (!txs) return [];
    const assets = new Set<string>();
    txs.forEach(tx => {
      // Collect all involved assets
      if (tx.fromAsset) assets.add(tx.fromAsset);
      if (tx.toAsset) assets.add(tx.toAsset);
    });
    return Array.from(assets);
  }, [txs]);

  // Calculate date range from transactions
  const dateRange = useMemo(() => {
    if (!txs || txs.length === 0) return undefined;
    
    const dates = txs.map(tx => new Date(tx.datetime).getTime() / 1000);
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    
    // Add some buffer (30 days before first transaction, 7 days after last)
    return {
      start: minDate - (30 * 24 * 60 * 60),
      end: maxDate + (7 * 24 * 60 * 60)
    };
  }, [txs]);

  // Use shared price data hook
  const { latestPrices, historicalPrices, isLoading: loadingPrices, hasData } = usePriceData({
    symbols: allAssets,
    dateRange,
    includeCurrentPrices: true
  });

  // Get EUR/USD rate for EURC valuation
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);
  const hasEURC = useMemo(() => allAssets.some(a => a.toUpperCase() === 'EURC'), [allAssets]);
  
  useEffect(() => {
    if (!hasEURC) {
      setEurUsdRate(null);
      return;
    }
    
    // Get today's date
    const today = new Date().toISOString().slice(0, 10);
    
    // Try to get EUR/USD rate for today, or use latest available
    getHistoricalExchangeRate('EUR', 'USD', today)
      .then(rate => setEurUsdRate(rate))
      .catch(() => {
        // Fallback: try to get rate from historical prices if available
        // Look for most recent EUR/USD rate in historical data
        if (historicalPrices.length > 0) {
          // Try to find a recent date with EUR/USD rate
          const recentDates = Array.from(new Set(historicalPrices.map(p => p.date)))
            .sort()
            .reverse()
            .slice(0, 10); // Try last 10 dates
          
          for (const date of recentDates) {
            getHistoricalExchangeRate('EUR', 'USD', date)
              .then(rate => {
                setEurUsdRate(rate);
                return;
              })
              .catch(() => {});
          }
        }
        // Final fallback
        setEurUsdRate(1.08);
      });
  }, [hasEURC, historicalPrices]);

  // Enhance latestPrices with EURC price (EUR/USD rate)
  const latestPricesWithEURC = useMemo(() => {
    const enhanced = { ...latestPrices };
    if (hasEURC && eurUsdRate !== null) {
      enhanced['EURC'] = eurUsdRate;
    }
    return enhanced;
  }, [latestPrices, hasEURC, eurUsdRate]);

  // Calculate P&L using the same logic as dashboard
  const pnlData = usePnLCalculation(txs, latestPricesWithEURC, historicalPrices);
  
  // Calculate holdings data
  const holdingsData = useMemo((): HoldingData[] => {
    if (!txs || loadingTxs || loadingPrices || !hasData) {
      return [];
    }

    const holdings = calculateHoldings(txs);
    const btcPrice = latestPrices['BTC'] || 0;

    return Object.entries(holdings)
      .filter(([_, quantity]) => quantity > 0)
      .map(([asset, quantity]) => {
        // Use EUR/USD rate for EURC
        let currentPrice = asset.toUpperCase() === 'EURC' && eurUsdRate !== null
          ? eurUsdRate
          : (latestPricesWithEURC[asset]);
        
        // Fallback: if price is missing or 0, try to get from historicalPrices (most recent)
        if ((currentPrice === undefined || currentPrice === 0) && asset.toUpperCase() !== 'EURC') {
          const assetPrices = historicalPrices.filter(p => p.asset === asset);
          if (assetPrices.length > 0) {
            // Sort by date descending and take the most recent price
            assetPrices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            currentPrice = assetPrices[0]!.price_usd;
          } else {
            currentPrice = 0;
          }
        }
        
        const currentValue = quantity * currentPrice;
        const btcValue = btcPrice > 0 ? currentValue / btcPrice : 0;
        
        // Get P&L data from the shared calculation
        const assetPnL = pnlData.assetPnL[asset] || { pnl: 0, pnlPercent: 0, costBasis: 0, currentValue: 0 };
        
        // Get market cap from historical data (most recent)
        let marketCap = 0;
        if (historicalPrices.length > 0) {
          const latestPrice = historicalPrices
            .filter(p => p.asset === asset)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
          // Note: Market cap would need to be added to PricePoint type or fetched separately
          // For now, we'll use 0 as placeholder
          marketCap = 0;
        }

        return {
          asset,
          name: getAssetName(asset),
          quantity,
          currentPrice,
          currentValue,
          btcValue,
          marketCap,
          avgCost: assetPnL.costBasis / quantity, // Calculate average cost
          costBasis: assetPnL.costBasis,
          pnl: assetPnL.pnl,
          pnlPercent: assetPnL.pnlPercent,
          color: getAssetColor(asset)
        };
      })
      .sort((a, b) => b.currentValue - a.currentValue);
  }, [txs, latestPricesWithEURC, eurUsdRate, loadingTxs, loadingPrices, hasData, historicalPrices, pnlData.assetPnL]);

  // Calculate portfolio summary using shared P&L data
  const portfolioSummary = useMemo((): PortfolioSummary => {
    const totalValue = holdingsData.reduce((sum, holding) => sum + holding.currentValue, 0);
    
    return {
      totalValue,
      totalPnl: pnlData.totalPnL,
      totalPnlPercent: pnlData.totalPnLPercent,
      assetCount: holdingsData.length
    };
  }, [holdingsData, pnlData]);

  const isLoading = loadingTxs || loadingPrices;
  const hasError = !txs && !loadingTxs;

  return {
    holdingsData,
    portfolioSummary,
    isLoading,
    hasError
  };
}
