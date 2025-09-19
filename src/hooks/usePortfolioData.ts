import { useMemo } from 'react';
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
      if (tx.type === 'Buy' || tx.type === 'Sell') {
        assets.add(tx.asset);
      }
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

  // Calculate P&L using the same logic as dashboard
  const pnlData = usePnLCalculation(txs, latestPrices, historicalPrices);
  
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
        const currentPrice = latestPrices[asset] || 0;
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
  }, [txs, latestPrices, loadingTxs, loadingPrices, hasData, historicalPrices, pnlData.assetPnL]);

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
