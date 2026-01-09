'use client';
import useSWR, { useSWRConfig } from 'swr';
import { useMemo, useState, useEffect, useRef } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, SUPPORTED_ASSETS, isStablecoin } from '@/lib/assets';
import AssetInput from '../components/AssetInput';
import CryptoIcon from '../components/CryptoIcon';
import { SupportedAsset } from '../../lib/assets';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';
import { STABLECOINS } from '@/lib/types';
import { getTransactionDefaults } from '../../lib/transaction-helpers';
import { getHistoricalExchangeRate } from '@/lib/exchange-rates';
import { calculateHoldings } from '@/lib/portfolio-utils';
import { fetchHistoricalWithLocalCache } from '@/lib/prices-cache';
import AuthGuard from '@/components/AuthGuard';

const fetcher = jsonFetcher;

type TransactionType = 'Deposit' | 'Withdrawal' | 'Swap';

interface NewTransaction {
  type: TransactionType;
  
  // From fields (only for Swap)
  fromAsset: string;
  fromQuantity: string;
  fromPriceUsd: string;
  fromSelectedAsset: SupportedAsset | null;
  
  // To fields (all types)
  toAsset: string;
  toQuantity: string;
  toPriceUsd: string;
  toSelectedAsset: SupportedAsset | null;
  
  // Deposit/Withdrawal-specific: Fiat currency and amount
  fiatCurrency: string;
  fiatAmount: string;
  
  // Swap-specific: Transaction USD value (used to calculate prices)
  swapUsdValue: string;
  
  // Common fields
  datetime: string;
  notes: string;
  feesUsd: string;
}

export default function TransactionsPage(){
  const { selectedId } = usePortfolio();
  const swrKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, mutate: mutateLocal } = useSWR<Tx[]>(swrKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const { mutate: mutateGlobal } = useSWRConfig();

  const forceRefresh = async (deletedId?: number): Promise<void> => {
    if (!swrKey) return;
    await mutateGlobal(swrKey, undefined, { revalidate: false });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    let retries = 0;
    const maxRetries = deletedId !== undefined ? 6 : 0;
    let freshData: Tx[] | null = null;
    
    while (retries <= maxRetries) {
      const freshRes = await fetch(swrKey, { 
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      
      if (!freshRes.ok) {
        throw new Error('Failed to fetch fresh data');
      }
      
      freshData = await freshRes.json();
      
      if (deletedId !== undefined && freshData) {
        const stillExists = freshData.some(tx => tx.id === deletedId);
        if (!stillExists) {
          break;
        }
        
        if (retries < maxRetries) {
          retries++;
          await new Promise(resolve => setTimeout(resolve, 300 * retries));
          continue;
        } else {
          console.warn(`Deleted transaction ${deletedId} still appears after ${maxRetries} retries`);
          break;
        }
      } else {
        break;
      }
    }
    
    if (freshData) {
      await mutateLocal(freshData, { revalidate: false });
      await mutateGlobal(swrKey, freshData, { revalidate: false });
    }
    
    await mutateGlobal(
      (key: unknown) => typeof key === 'string' && key.startsWith('/api/transactions'),
      undefined,
      { revalidate: true }
    );
    
    await new Promise(resolve => setTimeout(resolve, 150));
  };

  const [assetFilter, setAssetFilter] = useState<string>('All');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [isOpen, setIsOpen] = useState(false);
  const [swapMode, setSwapMode] = useState<'buy' | 'sell' | 'swap' | null>(null);
  const [newTx, setNewTx] = useState<NewTransaction>({ 
    type: 'Swap',
    fromAsset: '',
    fromQuantity: '',
    fromPriceUsd: '',
    fromSelectedAsset: null,
    toAsset: '',
    toQuantity: '',
    toPriceUsd: '',
    toSelectedAsset: null,
    fiatCurrency: 'USD',
    fiatAmount: '',
    swapUsdValue: '',
    datetime: '',
    notes: '',
    feesUsd: '',
  });
  const [txErrors, setTxErrors] = useState<string[]>([]);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [editing, setEditing] = useState<Tx|null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=>{
      if (t.fromAsset) s.add(t.fromAsset.toUpperCase());
      s.add(t.toAsset.toUpperCase());
    });
    return ['All', ...Array.from(s).sort()];
  }, [txs]);

  // Calculate current holdings for balance validation
  const currentHoldings = useMemo(() => {
    if (!txs) return {};
    return calculateHoldings(txs);
  }, [txs]);

  const filtered = useMemo(()=>{
    const list = (txs||[]).filter(t=> {
      if (assetFilter==='All') return true;
      const asset = assetFilter.toUpperCase();
      return t.toAsset.toUpperCase()===asset || (t.fromAsset && t.fromAsset.toUpperCase()===asset);
    });
    return list.sort((a,b)=> sortDir==='asc' ? new Date(a.datetime).getTime()-new Date(b.datetime).getTime() : new Date(b.datetime).getTime()-new Date(a.datetime).getTime());
  }, [txs, assetFilter, sortDir]);

  useEffect(() => {
    if (isOpen && !newTx.datetime) {
      getTransactionDefaults(null).then(defaults => {
        setNewTx(prev => ({
          ...prev,
          datetime: defaults.datetime
        }));
      });
    }
  }, [isOpen, newTx.datetime]);

  // Auto-set toPriceUsd to 1.0 for Deposit/Withdrawal
  useEffect(() => {
    if (newTx.type === 'Deposit' || newTx.type === 'Withdrawal') {
      if (!newTx.toPriceUsd || newTx.toPriceUsd === '') {
        setNewTx(prev => ({
          ...prev,
          toPriceUsd: '1.0'
        }));
      }
    }
  }, [newTx.type]);

  // Helper function to calculate and show hints (non-intrusive)
  const getCalculationHint = () => {
    if (newTx.type === 'Deposit') {
      if (newTx.fiatAmount && newTx.toQuantity && Number(newTx.fiatAmount) > 0 && Number(newTx.toQuantity) > 0) {
        const calculatedRate = Number(newTx.toQuantity) / Number(newTx.fiatAmount);
        const currentRate = Number(newTx.toPriceUsd) || 1.0;
        if (Math.abs(calculatedRate - currentRate) > 0.001) {
          return `💡 Tip: Based on your amounts, the rate should be ${calculatedRate.toFixed(4)}`;
        }
      }
    } else if (newTx.type === 'Withdrawal') {
      if (newTx.fiatAmount && newTx.toQuantity && Number(newTx.fiatAmount) > 0 && Number(newTx.toQuantity) > 0) {
        const calculatedRate = Number(newTx.fiatAmount) / Number(newTx.toQuantity);
        const currentRate = Number(newTx.toPriceUsd) || 1.0;
        if (Math.abs(calculatedRate - currentRate) > 0.001) {
          return `💡 Tip: Based on your amounts, the rate should be ${calculatedRate.toFixed(4)}`;
        }
      }
    } else if (newTx.type === 'Swap') {
      // For swaps, calculate USD values and show if they match
      if (newTx.fromQuantity && newTx.fromPriceUsd && newTx.toQuantity && newTx.toPriceUsd) {
        const fromUsd = Number(newTx.fromQuantity) * Number(newTx.fromPriceUsd);
        const toUsd = Number(newTx.toQuantity) * Number(newTx.toPriceUsd);
        const diff = Math.abs(fromUsd - toUsd);
        const diffPercent = fromUsd > 0 ? (diff / fromUsd) * 100 : 0;
        
        if (diffPercent > 1) { // More than 1% difference
          return `💡 USD values: ${fromUsd.toFixed(2)} → ${toUsd.toFixed(2)} (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(2)}%)`;
        }
      }
    }
    return null;
  };

  // Helper function to get historical price for a specific date
  const getHistoricalPriceForDate = async (symbol: string, date: string): Promise<number | null> => {
    if (!date) return null;
    
    try {
      const dateObj = new Date(date);
      const dateStr = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
      const unixSec = Math.floor(dateObj.getTime() / 1000);
      
      // Fetch historical prices for a small range around the date
      const startUnix = unixSec - (7 * 24 * 60 * 60); // 7 days before
      const endUnix = unixSec + (7 * 24 * 60 * 60); // 7 days after
      
      const histData = await fetchHistoricalWithLocalCache([symbol.toUpperCase()], startUnix, endUnix);
      
      // Find the price for the exact date, or closest date
      let pricePoint = histData.prices.find(p => p.asset === symbol.toUpperCase() && p.date === dateStr);
      
      if (!pricePoint && histData.prices.length > 0) {
        // Find closest date
        const relevantPrices = histData.prices
          .filter(p => p.asset === symbol.toUpperCase())
          .sort((a, b) => Math.abs(new Date(a.date).getTime() - dateObj.getTime()) - Math.abs(new Date(b.date).getTime() - dateObj.getTime()));
        pricePoint = relevantPrices[0];
      }
      
      return pricePoint ? pricePoint.price_usd : null;
    } catch (error) {
      console.error('Failed to fetch historical price:', error);
      return null;
    }
  };
  
  // Auto-calculate USD value based on quantity, asset, and date
  useEffect(() => {
    if (newTx.type === 'Swap' && newTx.datetime) {
      const calculateUsdValue = async () => {
        // For Buy: USD value = stablecoin quantity (stablecoins are $1)
        if (swapMode === 'buy' && newTx.fromAsset && isStablecoin(newTx.fromAsset) && newTx.fromQuantity) {
          const quantity = Number(newTx.fromQuantity);
          if (quantity > 0) {
            const calculatedUsdValue = quantity.toFixed(2);
            const currentUsdValue = Number(newTx.swapUsdValue) || 0;
            // Only auto-fill if empty or very close (user hasn't manually changed it)
            if (!newTx.swapUsdValue || Math.abs(currentUsdValue - quantity) < 0.01) {
              const inputElement = document.activeElement as HTMLInputElement;
              if (!inputElement || inputElement.name !== 'swapUsdValue') {
                setNewTx(prev => ({
                  ...prev,
                  swapUsdValue: calculatedUsdValue
                }));
              }
            }
          }
        }
        // For Sell: USD value = stablecoin quantity received
        else if (swapMode === 'sell' && newTx.toAsset && isStablecoin(newTx.toAsset) && newTx.toQuantity) {
          const quantity = Number(newTx.toQuantity);
          if (quantity > 0) {
            const calculatedUsdValue = quantity.toFixed(2);
            const currentUsdValue = Number(newTx.swapUsdValue) || 0;
            if (!newTx.swapUsdValue || Math.abs(currentUsdValue - quantity) < 0.01) {
              const inputElement = document.activeElement as HTMLInputElement;
              if (!inputElement || inputElement.name !== 'swapUsdValue') {
                setNewTx(prev => ({
                  ...prev,
                  swapUsdValue: calculatedUsdValue
                }));
              }
            }
          }
        }
        // For Swap (crypto to crypto): Calculate based on historical price at transaction date
        else if (swapMode === 'swap' && newTx.fromAsset && newTx.fromQuantity && !isStablecoin(newTx.fromAsset)) {
          const quantity = Number(newTx.fromQuantity);
          if (quantity > 0) {
            const dateStr = newTx.datetime.split('T')[0]; // Get date part
            const historicalPrice = await getHistoricalPriceForDate(newTx.fromAsset, dateStr);
            
            if (historicalPrice && historicalPrice > 0) {
              const calculatedUsdValue = (quantity * historicalPrice).toFixed(2);
              const currentUsdValue = Number(newTx.swapUsdValue) || 0;
              const calculatedValueNum = Number(calculatedUsdValue);
              
              // Only auto-fill if empty or very close (user hasn't manually changed it)
              if (!newTx.swapUsdValue || Math.abs(currentUsdValue - calculatedValueNum) / calculatedValueNum < 0.01) {
                const inputElement = document.activeElement as HTMLInputElement;
                if (!inputElement || inputElement.name !== 'swapUsdValue') {
                  setNewTx(prev => ({
                    ...prev,
                    swapUsdValue: calculatedUsdValue
                  }));
                }
              }
            }
          }
        }
      };
      
      calculateUsdValue();
    }
  }, [newTx.type, newTx.datetime, swapMode, newTx.fromAsset, newTx.fromQuantity, newTx.toAsset, newTx.toQuantity, newTx.swapUsdValue]);

  // Auto-calculate From Price USD from Transaction USD Value and From Quantity
  // Only update if the calculated value is significantly different to avoid loops
  useEffect(() => {
    if (newTx.type === 'Swap' && newTx.swapUsdValue && newTx.fromQuantity) {
      const usdValue = Number(newTx.swapUsdValue);
      const quantity = Number(newTx.fromQuantity);
      if (usdValue > 0 && quantity > 0) {
        const calculatedPrice = usdValue / quantity;
        const currentPrice = Number(newTx.fromPriceUsd) || 0;
        // Only update if difference is significant (> 0.1% or if current is 0)
        const priceDiff = currentPrice === 0 ? calculatedPrice : Math.abs(calculatedPrice - currentPrice) / currentPrice;
        if (currentPrice === 0 || priceDiff > 0.001) {
          const calculatedPriceStr = calculatedPrice.toFixed(8).replace(/\.?0+$/, '');
          const currentPriceStr = newTx.fromPriceUsd || '';
          // Only update if string representation is different
          if (calculatedPriceStr !== currentPriceStr) {
            setNewTx(prev => ({
              ...prev,
              fromPriceUsd: calculatedPriceStr
            }));
          }
        }
      }
    }
  }, [newTx.type, newTx.swapUsdValue, newTx.fromQuantity]);

  // Auto-calculate To Price USD from Transaction USD Value and To Quantity
  // Only update if the calculated value is significantly different to avoid loops
  useEffect(() => {
    if (newTx.type === 'Swap' && newTx.swapUsdValue && newTx.toQuantity) {
      const usdValue = Number(newTx.swapUsdValue);
      const quantity = Number(newTx.toQuantity);
      if (usdValue > 0 && quantity > 0) {
        const calculatedPrice = usdValue / quantity;
        const currentPrice = Number(newTx.toPriceUsd) || 0;
        // Only update if difference is significant (> 0.1% or if current is 0)
        const priceDiff = currentPrice === 0 ? calculatedPrice : Math.abs(calculatedPrice - currentPrice) / currentPrice;
        if (currentPrice === 0 || priceDiff > 0.001) {
          const calculatedPriceStr = calculatedPrice.toFixed(8).replace(/\.?0+$/, '');
          const currentPriceStr = newTx.toPriceUsd || '';
          // Only update if string representation is different
          if (calculatedPriceStr !== currentPriceStr) {
            setNewTx(prev => ({
              ...prev,
              toPriceUsd: calculatedPriceStr
            }));
          }
        }
      }
    }
  }, [newTx.type, newTx.swapUsdValue, newTx.toQuantity]);

  // Auto-calculate for Deposit transactions
  useEffect(() => {
    if (newTx.type === 'Deposit' && newTx.fiatCurrency && newTx.fiatAmount && newTx.toQuantity) {
      const fiatAmount = Number(newTx.fiatAmount);
      const stablecoinAmount = Number(newTx.toQuantity);
      
      if (fiatAmount > 0 && stablecoinAmount > 0) {
        // Calculate exchange rate: stablecoin amount / fiat amount
        const exchangeRate = stablecoinAmount / fiatAmount;
        // Only update if the calculated rate is significantly different (avoid infinite loops)
        const currentRate = Number(newTx.toPriceUsd) || 1.0;
        if (Math.abs(exchangeRate - currentRate) > 0.001) {
          setNewTx(prev => ({
            ...prev,
            toPriceUsd: exchangeRate.toFixed(8)
          }));
        }
      }
    }
  }, [newTx.type, newTx.fiatCurrency, newTx.fiatAmount, newTx.toQuantity]);

  // Auto-calculate for Withdrawal transactions
  useEffect(() => {
    if (newTx.type === 'Withdrawal' && newTx.fiatCurrency && newTx.fiatAmount && newTx.toQuantity) {
      const fiatAmount = Number(newTx.fiatAmount);
      const stablecoinAmount = Number(newTx.toQuantity);
      
      if (fiatAmount > 0 && stablecoinAmount > 0) {
        // Calculate exchange rate: fiat amount / stablecoin amount
        const exchangeRate = fiatAmount / stablecoinAmount;
        const currentRate = Number(newTx.toPriceUsd) || 1.0;
        if (Math.abs(exchangeRate - currentRate) > 0.001) {
          setNewTx(prev => ({
            ...prev,
            toPriceUsd: exchangeRate.toFixed(8)
          }));
        }
      }
    }
  }, [newTx.type, newTx.fiatCurrency, newTx.fiatAmount, newTx.toQuantity]);

  const handleFromAssetSelection = async (asset: SupportedAsset | null, symbol: string) => {
    if (!asset) {
      setNewTx(prev => ({
        ...prev,
        fromAsset: symbol.toUpperCase(),
      }));
      return;
    }
    
    setIsLoadingPrice(true);
    setTxErrors([]);
    
    try {
      const defaults = await getTransactionDefaults(asset);
      // For swaps, calculate USD value based on current price and quantity
      const currentQuantity = Number(newTx.fromQuantity) || 0;
      const usdValue = currentQuantity > 0 
        ? (currentQuantity * Number(defaults.priceUsd)).toFixed(2)
        : defaults.priceUsd;
      
      setNewTx(prev => ({
        ...prev,
        fromAsset: symbol.toUpperCase(),
        fromSelectedAsset: asset,
        fromPriceUsd: defaults.priceUsd,
        swapUsdValue: prev.swapUsdValue || (currentQuantity > 0 ? usdValue : ''),
        datetime: prev.datetime || defaults.datetime
      }));
    } catch (error) {
      console.error('Failed to get transaction defaults:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const handleToAssetSelection = async (asset: SupportedAsset | null, symbol: string) => {
    // For Deposit/Withdrawal, validate that only stablecoins are selected
    if ((newTx.type === 'Deposit' || newTx.type === 'Withdrawal') && asset && !isStablecoin(symbol)) {
      setTxErrors([`For ${newTx.type} transactions, you can only use stablecoins (USDC, USDT, DAI, BUSD). Please select a stablecoin.`]);
      return;
    }
    
    if (!asset) {
      setNewTx(prev => ({
        ...prev,
        toAsset: symbol.toUpperCase(),
      }));
      return;
    }
    
    setIsLoadingPrice(true);
    setTxErrors([]);
    
    try {
      const defaults = await getTransactionDefaults(asset);
      setNewTx(prev => ({
        ...prev,
        toAsset: symbol.toUpperCase(),
        toSelectedAsset: asset,
        toPriceUsd: defaults.priceUsd,
        datetime: prev.datetime || defaults.datetime
      }));
    } catch (error) {
      console.error('Failed to get transaction defaults:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  async function addTx(e: React.FormEvent){
    e.preventDefault();
    setTxErrors([]);
    
    const portfolioId = (typeof selectedId === 'number' ? selectedId : null) ?? 1;

    if (newTx.type === 'Swap') {
      if (!newTx.fromAsset || !newTx.fromQuantity || !newTx.toAsset || !newTx.toQuantity) {
        setTxErrors(['For Swap transactions, fromAsset, fromQuantity, toAsset, and toQuantity are required']);
        return;
      }
    } else {
      if (!newTx.toAsset || !newTx.toQuantity) {
        setTxErrors([`For ${newTx.type} transactions, toAsset and toQuantity are required`]);
        return;
      }
      // Validate that Deposit/Withdrawal only use stablecoins
      if (!isStablecoin(newTx.toAsset)) {
        setTxErrors([`For ${newTx.type} transactions, you can only use stablecoins (USDC, USDT, DAI, BUSD). Please select a stablecoin.`]);
        return;
      }
      // For Deposit, validate fiat currency and amount
      if (newTx.type === 'Deposit') {
        if (!newTx.fiatCurrency || !newTx.fiatAmount || Number(newTx.fiatAmount) <= 0) {
          setTxErrors(['For Deposit transactions, fiat currency and fiat amount are required']);
          return;
        }
      }
      // For Withdrawal, validate that user has enough balance
      if (newTx.type === 'Withdrawal') {
        const toAssetUpper = newTx.toAsset.toUpperCase();
        const currentBalance = currentHoldings[toAssetUpper] || 0;
        const withdrawQuantity = Number(newTx.toQuantity);
        if (withdrawQuantity > currentBalance) {
          setTxErrors([
            `Insufficient balance! You're trying to withdraw ${withdrawQuantity.toFixed(8)} ${toAssetUpper}, but you only have ${currentBalance.toFixed(8)} ${toAssetUpper} available.`
          ]);
          return;
        }
      }
    }

    // Build payload based on transaction type
    let payload: any = {
      type: newTx.type,
      toAsset: newTx.toAsset,
      toQuantity: Number(newTx.toQuantity),
      toPriceUsd: newTx.toPriceUsd ? Number(newTx.toPriceUsd) : null,
      datetime: newTx.datetime,
      notes: newTx.notes || null,
      feesUsd: newTx.feesUsd ? Number(newTx.feesUsd) : null,
      portfolioId,
    };

    if (newTx.type === 'Swap') {
      payload.fromAsset = newTx.fromAsset;
      payload.fromQuantity = newTx.fromQuantity ? Number(newTx.fromQuantity) : null;
      payload.fromPriceUsd = newTx.fromPriceUsd ? Number(newTx.fromPriceUsd) : null;
    } else if (newTx.type === 'Deposit') {
      // For Deposit: fromAsset = fiat currency, fromQuantity = fiat amount
      payload.fromAsset = newTx.fiatCurrency.toUpperCase();
      payload.fromQuantity = Number(newTx.fiatAmount);
      // For USD, price is 1.0. For EUR, fetch the exchange rate for the transaction date
      if (newTx.fiatCurrency.toUpperCase() === 'USD') {
        payload.fromPriceUsd = 1.0;
      } else {
        // For EUR, get the EUR/USD rate for the transaction date
        try {
          const txDate = newTx.datetime ? newTx.datetime.split('T')[0] : new Date().toISOString().split('T')[0];
          const eurUsdRate = await getHistoricalExchangeRate('EUR', 'USD', txDate);
          payload.fromPriceUsd = eurUsdRate;
        } catch (error) {
          console.warn('Failed to fetch EUR/USD rate, using default 1.08:', error);
          payload.fromPriceUsd = 1.08; // Fallback to approximate rate
        }
      }
    } else if (newTx.type === 'Withdrawal') {
      // For Withdrawal: fromAsset = stablecoin, fromQuantity = stablecoin amount
      // toAsset = fiat currency, toQuantity = fiat amount
      payload.fromAsset = newTx.toAsset; // The stablecoin being withdrawn
      payload.fromQuantity = Number(newTx.toQuantity); // The stablecoin amount
      payload.fromPriceUsd = 1.0; // Stablecoins are always $1
      
      // Update toAsset and toQuantity to be the fiat currency and amount
      payload.toAsset = newTx.fiatCurrency.toUpperCase();
      payload.toQuantity = Number(newTx.fiatAmount);
      // For USD, price is 1.0. For EUR, fetch the exchange rate
      if (newTx.fiatCurrency.toUpperCase() === 'USD') {
        payload.toPriceUsd = 1.0;
      } else {
        try {
          const txDate = newTx.datetime ? newTx.datetime.split('T')[0] : new Date().toISOString().split('T')[0];
          const eurUsdRate = await getHistoricalExchangeRate('EUR', 'USD', txDate);
          payload.toPriceUsd = eurUsdRate;
        } catch (error) {
          console.warn('Failed to fetch EUR/USD rate, using default 1.08:', error);
          payload.toPriceUsd = 1.08;
        }
      }
    }
    
    setIsSaving(true);
    try {
      const res = await fetch('/api/transactions', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        await res.json();
        await forceRefresh();
        
        setIsOpen(false);
        setSwapMode(null);
        setNewTx({ 
          type: 'Swap',
          fromAsset: '',
          fromQuantity: '',
          fromPriceUsd: '',
          fromSelectedAsset: null,
          toAsset: '',
          toQuantity: '',
          toPriceUsd: '',
          toSelectedAsset: null,
          fiatCurrency: 'USD',
          fiatAmount: '',
          swapUsdValue: '',
          datetime: '',
          notes: '',
          feesUsd: '',
        }); 
        setTxErrors([]);
        
        window.dispatchEvent(new CustomEvent('transactions-changed')); 
      } else {
        const errorData = await res.json();
        // Handle different error response formats
        let errors: string[] = [];
        if (typeof errorData === 'string') {
          errors = [errorData];
        } else if (errorData.error) {
          // Check if error is a Zod flattened error object
          if (typeof errorData.error === 'object' && errorData.error !== null) {
            const zodError = errorData.error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
            if (zodError.formErrors && Array.isArray(zodError.formErrors)) {
              errors = zodError.formErrors;
            } else if (zodError.fieldErrors && typeof zodError.fieldErrors === 'object') {
              errors = Object.entries(zodError.fieldErrors)
                .flatMap(([field, fieldErrs]) => 
                  Array.isArray(fieldErrs) 
                    ? fieldErrs.map(err => `${field}: ${err}`)
                    : [`${field}: ${String(fieldErrs)}`]
                );
            } else {
              errors = ['Invalid transaction data'];
            }
          } else if (typeof errorData.error === 'string') {
            errors = [errorData.error];
          } else {
            errors = ['Failed to save transaction'];
          }
        } else if (errorData.formErrors && Array.isArray(errorData.formErrors)) {
          errors = errorData.formErrors;
        } else if (errorData.fieldErrors && typeof errorData.fieldErrors === 'object') {
          errors = Object.entries(errorData.fieldErrors)
            .flatMap(([field, fieldErrs]) => 
              Array.isArray(fieldErrs) 
                ? fieldErrs.map(err => `${field}: ${err}`)
                : [`${field}: ${String(fieldErrs)}`]
            );
        } else if (errorData.message) {
          errors = [errorData.message];
        } else {
          errors = ['Failed to save transaction'];
        }
        setTxErrors(errors);
      }
    } catch (error) {
      console.error('Error adding transaction:', error);
      setTxErrors(['Network error. Please try again.']);
    } finally {
      setIsSaving(false);
    }
  }

  async function removeTx(id: number){
    if (!confirm('Delete this transaction?')) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/transactions?id=${id}`, { method:'DELETE' });
      if (res.ok) {
        await res.json();
        await forceRefresh(id);
        window.dispatchEvent(new CustomEvent('transactions-changed'));
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        alert(errorData.error || 'Failed to delete transaction. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting transaction:', error);
      alert('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(t: Tx){ setEditing(t); }

  async function saveEdit(e: React.FormEvent){
    e.preventDefault();
    if (!editing) return;
    setIsSaving(true);
    try {
      const body: Partial<Tx> = {
        id: editing.id,
        type: editing.type,
        fromAsset: editing.fromAsset,
        fromQuantity: editing.fromQuantity,
        fromPriceUsd: editing.fromPriceUsd,
        toAsset: editing.toAsset,
        toQuantity: editing.toQuantity,
        toPriceUsd: editing.toPriceUsd,
        datetime: editing.datetime,
        notes: editing.notes ?? null,
        feesUsd: editing.feesUsd ?? null,
      };
      const res = await fetch('/api/transactions', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        await res.json();
        await forceRefresh();
        setEditing(null);
        window.dispatchEvent(new CustomEvent('transactions-changed'));
      } else {
        const errorData = await res.json();
        alert(errorData.error || 'Failed to update transaction. Please try again.');
      }
    } catch (error) {
      console.error('Error updating transaction:', error);
      alert('Network error. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  const nf = new Intl.NumberFormat(undefined,{ maximumFractionDigits: 8 });
  const df = new Intl.DateTimeFormat(undefined,{ dateStyle:'medium', timeStyle:'short' });

  return (
    <AuthGuard redirectTo="/transactions">
      <main>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          Transaction Management
        </h1>
        <p className="subtitle">Track and manage all your cryptocurrency transactions with precision</p>
      </div>
      <div className="toolbar">
        <div className="filters">
          <label>Asset
            <select value={assetFilter} onChange={e=>setAssetFilter(e.target.value)}>{assets.map(a=> <option key={a} value={a}>{a}</option>)}</select>
          </label>
          <label>Sort by date
            <select value={sortDir} onChange={e=>setSortDir((e.target.value as 'asc'|'desc'))}>
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
        </div>
        <div className="transaction-toolbar-actions">
          <button 
            className="btn btn-primary" 
            onClick={()=>setIsOpen(true)}
            disabled={isSaving}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}
          >
            <span>➕</span>
            Add Transaction
          </button>
          {selectedId && (
            <>
              <form 
                onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const format = formData.get('format') as string;
                  const url = `/api/transactions/export?portfolioId=${selectedId}&format=${format}`;
                  
                  try {
                    const response = await fetch(url, { method: 'POST' });
                    if (response.ok) {
                      const blob = await response.blob();
                      const downloadUrl = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = downloadUrl;
                      a.download = `transactions_portfolio_${selectedId}${format === 'tradingview' ? '_tradingview' : ''}.csv`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      window.URL.revokeObjectURL(downloadUrl);
                    }
                  } catch (error) {
                    console.error('Export failed:', error);
                  }
                }}
                className="transaction-export-form"
              >
                <select 
                  name="format" 
                  defaultValue="default"
                  style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border)' }}
                >
                  <option value="default">Default Format</option>
                  <option value="tradingview">TradingView Format</option>
                </select>
                <button 
                  type="submit" 
                  className="btn btn-success"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <span>📊</span>
                  Export CSV
                </button>
              </form>
              <div className="transaction-import-wrapper">
                <label 
                  className="btn btn-secondary" 
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}
                >
                  <span>📁</span>
                  Import CSV
                  <input type="file" accept=".csv" style={{ display:'none' }} onChange={async (e)=>{
                    const file = e.target.files?.[0]; if (!file) return;
                    setIsSaving(true);
                    try {
                      const fd = new FormData(); fd.append('file', file);
                      const res = await fetch(`/api/transactions/import?portfolioId=${selectedId}`, { method:'POST', body: fd });
                      if (res.ok) {
                        await res.json();
                        await forceRefresh();
                        window.dispatchEvent(new CustomEvent('transactions-changed'));
                        e.target.value = '';
                      } else {
                        const errorData = await res.json();
                        alert(errorData.error || 'Failed to import transactions. Please check the file format.');
                      }
                    } catch (error) {
                      console.error('Error importing transactions:', error);
                      alert('Network error. Please try again.');
                    } finally {
                      setIsSaving(false);
                    }
                  }} />
                </label>
              </div>
            </>
          )}
        </div>
      </div>

      {isSaving && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          cursor: 'wait'
        }}>
          <div style={{
            backgroundColor: 'var(--surface)',
            padding: '2rem',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem'
          }}>
            <div className="loading-spinner" style={{ width: '40px', height: '40px' }}></div>
            <div style={{ fontSize: '1rem', fontWeight: 600 }}>Saving transaction...</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Please wait while we update the database</div>
          </div>
        </div>
      )}

      <section className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>From</th><th>To</th><th>Notes</th><th></th>
              </tr>
            </thead>
          <tbody>
            {filtered.map(t=> (
              <tr key={t.id}>
                <td>{df.format(new Date(t.datetime))}</td>
                <td>{t.type}</td>
                <td>
                  {t.fromAsset ? (
                    <span style={{ display:'inline-flex', gap:6, flexDirection:'column', alignItems:'flex-start' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                        <CryptoIcon symbol={t.fromAsset} size={18} alt={`${t.fromAsset} logo`} />
                        <span style={{ display:'inline-block', padding:'2px 8px', borderRadius: 12, background: `${getAssetColor(t.fromAsset)}22`, color: getAssetColor(t.fromAsset), fontWeight:600 }}>
                          {t.fromAsset.toUpperCase()}
                        </span>
                      </span>
                      <span style={{fontSize:'0.9em', color:'var(--muted)'}}>{t.fromQuantity ? nf.format(t.fromQuantity) : ''} @ ${t.fromPriceUsd ? nf.format(t.fromPriceUsd) : ''}</span>
                    </span>
                  ) : '-'}
                </td>
                <td>
                  <span style={{ display:'inline-flex', gap:6, flexDirection:'column', alignItems:'flex-start' }}>
                    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                      <CryptoIcon symbol={t.toAsset} size={18} alt={`${t.toAsset} logo`} />
                      <span style={{ display:'inline-block', padding:'2px 8px', borderRadius: 12, background: `${getAssetColor(t.toAsset)}22`, color: getAssetColor(t.toAsset), fontWeight:600 }}>
                        {t.toAsset.toUpperCase()}
                      </span>
                    </span>
                    <span style={{fontSize:'0.9em', color:'var(--muted)'}}>{nf.format(t.toQuantity)} @ ${t.toPriceUsd ? nf.format(t.toPriceUsd) : ''}</span>
                  </span>
                </td>
                <td>{t.notes||''}</td>
                <td style={{ whiteSpace:'nowrap' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn btn-secondary btn-sm" 
                      onClick={()=>startEdit(t)}
                      disabled={isSaving}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <span style={{ fontSize: '0.8rem' }}>✏️</span>
                      Edit
                    </button>
                    <button 
                      className="btn btn-danger btn-sm" 
                      onClick={()=>removeTx(t.id)}
                      disabled={isSaving}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <span style={{ fontSize: '0.8rem' }}>🗑️</span>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length===0 && (<tr><td colSpan={6}>No transactions</td></tr>)}
          </tbody>
        </table>
        </div>
      </section>

      {isOpen && (
          <div className="modal-backdrop" onClick={(e)=>{ 
            if (e.target === e.currentTarget) {
              setIsOpen(false);
              setSwapMode(null);
            }
          }}>
          <div className="modal transaction-modal" role="dialog" aria-modal="true">
            <div className="card-header">
              <div className="card-title">
                <h3>Add Transaction</h3>
              </div>
            </div>
            
            {txErrors.length > 0 && (
              <div className="error-messages">
                {txErrors.map((error, i) => (
                  <div key={i} className="error-message">{error}</div>
                ))}
              </div>
            )}
            
            <form onSubmit={addTx} className="transaction-form">
              {/* Transaction Type - Always visible at top */}
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Transaction Type *
                </label>
                <select 
                  value={newTx.type} 
                  onChange={e=>{
                    const newType = e.target.value as TransactionType;
                    setNewTx(v=>({ 
                      ...v, 
                      type: newType,
                      // Reset fields when switching types
                      fromAsset: '',
                      fromQuantity: '',
                      fromSelectedAsset: null,
                      toAsset: '',
                      toQuantity: '',
                      toSelectedAsset: null,
                      fiatCurrency: (newType === 'Deposit' || newType === 'Withdrawal') ? (v.fiatCurrency || 'USD') : 'USD',
                      fiatAmount: (newType === 'Deposit' || newType === 'Withdrawal') ? v.fiatAmount : '',
                      swapUsdValue: '',
                    }));
                    // Reset swap mode when switching away from Swap
                    if (newType !== 'Swap') {
                      setSwapMode(null);
                    }
                  }}
                  className="form-select"
                >
                  <option value="Deposit">💰 Deposit (Fiat → Stablecoin)</option>
                  <option value="Withdrawal">💸 Withdrawal (Stablecoin → Fiat)</option>
                  <option value="Swap">🔄 Swap (Crypto ↔ Crypto)</option>
                </select>
                {newTx.type === 'Deposit' && (
                  <small style={{ color: 'var(--primary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                    💡 You deposited fiat money (USD or EUR) and received stablecoin
                  </small>
                )}
                {newTx.type === 'Withdrawal' && (
                  <small style={{ color: 'var(--primary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                    💡 You converted stablecoin to fiat money
                  </small>
                )}
                {newTx.type === 'Swap' && (
                  <small style={{ color: 'var(--primary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                    💡 Choose: Buy (Stablecoin → Crypto), Sell (Crypto → Stablecoin), or Swap (Crypto → Crypto)
                  </small>
                )}
              </div>


              {/* Swap Form - Redesigned for Intuitive UX */}
              {/* Swap Transaction - Three Specialized Forms */}
              {newTx.type === 'Swap' && (
                <>
                  {/* Sub-type selector for Swap */}
                  <div className="form-group">
                    <label style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                      What type of swap? *
                    </label>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(3, 1fr)', 
                      gap: '8px',
                      marginBottom: '16px'
                    }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSwapMode('buy');
                          // Buy: Stablecoin → Crypto
                          setNewTx(v => ({
                            ...v,
                            fromAsset: '',
                            toAsset: '',
                            fromSelectedAsset: null,
                            toSelectedAsset: null,
                            fromQuantity: '',
                            toQuantity: '',
                            swapUsdValue: '',
                          }));
                        }}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: swapMode === 'buy' ? '2px solid var(--primary)' : '2px solid var(--border)',
                          background: swapMode === 'buy' ? 'rgba(var(--primary-rgb), 0.15)' : 'var(--surface)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 600,
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        onMouseEnter={(e) => {
                          if (swapMode !== 'buy') {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (swapMode !== 'buy') {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.background = 'var(--surface)';
                          }
                        }}
                      >
                        <span style={{ fontSize: '20px' }}>📈</span>
                        <span>Buy</span>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 400 }}>Stablecoin → Crypto</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSwapMode('sell');
                          // Sell: Crypto → Stablecoin
                          setNewTx(v => ({
                            ...v,
                            fromAsset: '',
                            toAsset: '',
                            fromSelectedAsset: null,
                            toSelectedAsset: null,
                            fromQuantity: '',
                            toQuantity: '',
                            swapUsdValue: '',
                          }));
                        }}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: swapMode === 'sell' ? '2px solid var(--primary)' : '2px solid var(--border)',
                          background: swapMode === 'sell' ? 'rgba(var(--primary-rgb), 0.15)' : 'var(--surface)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 600,
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        onMouseEnter={(e) => {
                          if (swapMode !== 'sell') {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (swapMode !== 'sell') {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.background = 'var(--surface)';
                          }
                        }}
                      >
                        <span style={{ fontSize: '20px' }}>📉</span>
                        <span>Sell</span>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 400 }}>Crypto → Stablecoin</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSwapMode('swap');
                          // Swap: Crypto → Crypto
                          setNewTx(v => ({
                            ...v,
                            fromAsset: '',
                            toAsset: '',
                            fromSelectedAsset: null,
                            toSelectedAsset: null,
                            fromQuantity: '',
                            toQuantity: '',
                            swapUsdValue: '',
                          }));
                        }}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: swapMode === 'swap' ? '2px solid var(--primary)' : '2px solid var(--border)',
                          background: swapMode === 'swap' ? 'rgba(var(--primary-rgb), 0.15)' : 'var(--surface)',
                          color: 'var(--text)',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 600,
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        onMouseEnter={(e) => {
                          if (swapMode !== 'swap') {
                            e.currentTarget.style.borderColor = 'var(--primary)';
                            e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (swapMode !== 'swap') {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.background = 'var(--surface)';
                          }
                        }}
                      >
                        <span style={{ fontSize: '20px' }}>🔄</span>
                        <span>Swap</span>
                        <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 400 }}>Crypto → Crypto</span>
                      </button>
                    </div>
                  </div>

                  {/* USD Value - Central and Prominent */}
                  <div className="form-group" style={{ marginBottom: '20px' }}>
                    <label style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      💵 Transaction USD Value *
                      <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--muted)' }}>
                        (The total USD value of this transaction)
                      </span>
                    </label>
                    <input 
                      type="number" 
                      step="any" 
                      placeholder="0.00" 
                      name="swapUsdValue"
                      value={newTx.swapUsdValue} 
                      onChange={e=>setNewTx(v=>({ ...v, swapUsdValue: e.target.value }))} 
                      className="form-input"
                      style={{ fontSize: '18px', padding: '14px', fontWeight: 600 }}
                    />
                    <small style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '4px' }}>
                      {swapMode === 'buy' || swapMode === 'sell' 
                        ? 'Auto-filled from stablecoin amount (1:1 ratio). You can edit if needed.'
                        : swapMode === 'swap'
                        ? 'Auto-calculated from quantity × historical price at transaction date. You can edit if needed.'
                        : 'Enter the total USD value of this transaction at the time it occurred'}
                    </small>
                  </div>

                  {/* Visual Flow - Adapts based on selection */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr auto 1fr', 
                    gap: '16px', 
                    alignItems: 'center',
                    padding: '20px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px'
                  }}>
                    {/* FROM */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {(() => {
                          if (swapMode === 'buy') return 'You Pay';
                          if (swapMode === 'sell') return 'You Sell';
                          if (swapMode === 'swap') return 'You Swap From';
                          return 'You Swap From';
                        })()}
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '13px', marginBottom: '6px' }}>Asset *</label>
                        <AssetInput
                          value={newTx.fromAsset}
                          onChange={handleFromAssetSelection}
                          placeholder={
                            swapMode === 'sell'
                              ? "Select crypto (e.g., BTC)" 
                              : swapMode === 'buy'
                              ? "Select stablecoin (e.g., USDC)"
                              : "Select crypto (e.g., BTC)"
                          }
                          disabled={isLoadingPrice}
                          filter={
                            swapMode === 'sell'
                              ? (asset) => !isStablecoin(asset.symbol) // Sell: from must be crypto
                              : swapMode === 'buy'
                              ? (asset) => isStablecoin(asset.symbol) // Buy: from must be stablecoin
                              : (asset) => !isStablecoin(asset.symbol) // Swap: from must be crypto
                          }
                        />
                        {newTx.fromAsset && currentHoldings[newTx.fromAsset.toUpperCase()] !== undefined && (
                          <small style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                            Balance: {currentHoldings[newTx.fromAsset.toUpperCase()].toFixed(8)}
                          </small>
                        )}
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '13px', marginBottom: '6px' }}>Quantity *</label>
                        <input 
                          type="number" 
                          step="any" 
                          placeholder="0.00" 
                          value={newTx.fromQuantity} 
                          onChange={e=>setNewTx(v=>({ ...v, fromQuantity: e.target.value }))} 
                          required 
                          className="form-input"
                        />
                        {newTx.fromAsset && newTx.fromQuantity && (() => {
                          const balance = currentHoldings[newTx.fromAsset.toUpperCase()] || 0;
                          const quantity = Number(newTx.fromQuantity);
                          if (quantity > balance) {
                            return (
                              <small style={{ color: '#dc2626', fontSize: '11px', marginTop: '4px', fontWeight: 600, display: 'block' }}>
                                ⚠️ Available: {balance.toFixed(8)}
                              </small>
                            );
                          }
                          return null;
                        })()}
                        {newTx.fromQuantity && newTx.swapUsdValue && Number(newTx.fromQuantity) > 0 && Number(newTx.swapUsdValue) > 0 && (
                          <small style={{ color: 'var(--primary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                            Price: ${(Number(newTx.swapUsdValue) / Number(newTx.fromQuantity)).toFixed(2)} per unit
                          </small>
                        )}
                      </div>
                    </div>

                    {/* ARROW */}
                    <div style={{ 
                      fontSize: '32px', 
                      color: 'var(--primary)', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      padding: '0 8px'
                    }}>
                      →
                    </div>

                    {/* TO */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {(() => {
                          if (swapMode === 'buy') return 'You Buy';
                          if (swapMode === 'sell') return 'You Receive';
                          if (swapMode === 'swap') return 'You Receive';
                          return 'You Receive';
                        })()}
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '13px', marginBottom: '6px' }}>Asset *</label>
                        <AssetInput
                          value={newTx.toAsset}
                          onChange={handleToAssetSelection}
                          placeholder={
                            swapMode === 'buy'
                              ? "Select crypto (e.g., BTC)"
                              : swapMode === 'sell'
                              ? "Select stablecoin (e.g., USDC)"
                              : "Select crypto (e.g., ETH)"
                          }
                          disabled={isLoadingPrice}
                          filter={
                            swapMode === 'buy'
                              ? (asset) => !isStablecoin(asset.symbol) // Buy: to must be crypto
                              : swapMode === 'sell'
                              ? (asset) => isStablecoin(asset.symbol) // Sell: to must be stablecoin
                              : (asset) => !isStablecoin(asset.symbol) // Swap: to must be crypto
                          }
                        />
                        {newTx.toAsset && currentHoldings[newTx.toAsset.toUpperCase()] !== undefined && (
                          <small style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                            Balance: {currentHoldings[newTx.toAsset.toUpperCase()].toFixed(8)}
                          </small>
                        )}
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '13px', marginBottom: '6px' }}>Quantity *</label>
                        <input 
                          type="number" 
                          step="any" 
                          placeholder="0.00" 
                          value={newTx.toQuantity} 
                          onChange={e=>setNewTx(v=>({ ...v, toQuantity:e.target.value }))} 
                          required 
                          className="form-input"
                        />
                        {newTx.toQuantity && newTx.swapUsdValue && Number(newTx.toQuantity) > 0 && Number(newTx.swapUsdValue) > 0 && (
                          <small style={{ color: 'var(--primary)', fontSize: '11px', marginTop: '4px', display: 'block' }}>
                            Price: ${(Number(newTx.swapUsdValue) / Number(newTx.toQuantity)).toFixed(2)} per unit
                          </small>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Deposit/Withdrawal Sections - Keep existing design */}
              {(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') && (
                <div className="form-section">
                  <div className="form-section-title">
                    {newTx.type === 'Deposit' ? '💰 Deposited' : '💸 Withdrawn'}
                  </div>
                  <div className="form-section-compact">
                      <>
                        <div className="form-group">
                          <label>Currency *</label>
                          <select 
                            value={newTx.fiatCurrency} 
                            onChange={e=>setNewTx(v=>({ ...v, fiatCurrency: e.target.value }))}
                            className="form-select"
                          >
                            <option value="USD">USD</option>
                            <option value="EUR">EUR</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>
                            {newTx.type === 'Deposit' ? 'Amount Deposited *' : 'Amount Received *'}
                          </label>
                          <input 
                            type="number" 
                            step="any" 
                            placeholder="0.00" 
                            value={newTx.fiatAmount} 
                            onChange={e=>setNewTx(v=>({ ...v, fiatAmount: e.target.value }))} 
                            required 
                            className="form-input"
                          />
                          {newTx.fiatCurrency === 'EUR' && newTx.fiatAmount && Number(newTx.fiatAmount) > 0 && (
                            <small style={{ color: 'var(--primary)', fontSize: '11px', marginTop: '2px' }}>
                              ≈ ${(Number(newTx.fiatAmount) * 1.08).toFixed(2)} USD
                            </small>
                          )}
                        </div>
                      </>
                  </div>
                </div>
              )}

              {/* To Section - Only for Deposit/Withdrawal */}
              {(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') && (
                <div className="form-section">
                  <div className="form-section-title">
                    {newTx.type === 'Deposit' ? '💵 Received' : '💵 Received'}
                  </div>
                  <div className="form-section-compact">
                    <div className="form-group">
                      <label>
                        {newTx.type === 'Deposit' ? 'Stablecoin *' : 'Stablecoin *'}
                      </label>
                      <AssetInput
                        value={newTx.toAsset}
                        onChange={handleToAssetSelection}
                        placeholder={
                          newTx.type === 'Deposit' ? 'Select stablecoin (e.g., USDC)' :
                          'Select stablecoin (e.g., USDC)'
                        }
                        disabled={isLoadingPrice}
                        filter={(asset) => asset.category === 'stablecoin'}
                      />
                      {newTx.toAsset && currentHoldings[newTx.toAsset.toUpperCase()] !== undefined && newTx.type === 'Withdrawal' && (
                        <small style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>
                          Balance: {currentHoldings[newTx.toAsset.toUpperCase()].toFixed(8)}
                        </small>
                      )}
                    </div>
                    <div className="form-group">
                      <label>
                        {newTx.type === 'Deposit' ? 'Amount Received *' : 'Amount *'}
                      </label>
                      <input 
                        type="number" 
                        step="any" 
                        placeholder="0.00" 
                        value={newTx.toQuantity} 
                        onChange={e=>setNewTx(v=>({ ...v, toQuantity:e.target.value }))} 
                        required 
                        className="form-input"
                      />
                      {newTx.type === 'Withdrawal' && newTx.toAsset && newTx.toQuantity && (() => {
                        const balance = currentHoldings[newTx.toAsset.toUpperCase()] || 0;
                        const quantity = Number(newTx.toQuantity);
                        if (quantity > balance) {
                          return (
                            <small style={{ color: '#dc2626', fontSize: '11px', marginTop: '2px', fontWeight: 600 }}>
                              ⚠️ Available: {balance.toFixed(8)}
                            </small>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div className="form-group">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        Exchange Rate
                        {(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') && 
                         newTx.fiatAmount && 
                         newTx.toQuantity && 
                         Number(newTx.fiatAmount) > 0 && 
                         Number(newTx.toQuantity) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (newTx.type === 'Deposit') {
                                const rate = Number(newTx.toQuantity) / Number(newTx.fiatAmount);
                                setNewTx(v => ({ ...v, toPriceUsd: rate.toFixed(8).replace(/\.?0+$/, '') }));
                              } else {
                                const rate = Number(newTx.fiatAmount) / Number(newTx.toQuantity);
                                setNewTx(v => ({ ...v, toPriceUsd: rate.toFixed(8).replace(/\.?0+$/, '') }));
                              }
                            }}
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              background: 'var(--primary)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontWeight: 500
                            }}
                            title="Auto-calculate"
                          >
                            Auto
                          </button>
                        )}
                      </label>
                      <input 
                        type="number" 
                        step="any" 
                        placeholder="1.0"
                        value={newTx.toPriceUsd} 
                        onChange={e=>setNewTx(v=>({ ...v, toPriceUsd:e.target.value }))}
                        className="form-input"
                      />
                    </div>
                    {getCalculationHint() && (
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <small style={{ color: 'var(--primary)', fontSize: '11px', fontStyle: 'italic' }}>
                          {getCalculationHint()}
                        </small>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Additional Details Section */}
              <div className="form-section">
                <div className="form-section-title">📝 Additional Details</div>
                <div className="form-section-compact">
                  <div className="form-group">
                    <label>Date & Time *</label>
                    <input 
                      type="datetime-local" 
                      value={newTx.datetime} 
                      onChange={e=>setNewTx(v=>({ ...v, datetime:e.target.value }))} 
                      required 
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Fees (USD)</label>
                    <input 
                      type="number" 
                      step="any" 
                      placeholder="0.00" 
                      value={newTx.feesUsd} 
                      onChange={e=>setNewTx(v=>({ ...v, feesUsd:e.target.value }))} 
                      className="form-input"
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Notes</label>
                    <input 
                      placeholder="Optional notes about this transaction" 
                      value={newTx.notes || ''} 
                      onChange={e=>setNewTx(v=>({ ...v, notes:e.target.value }))}
                      className="form-input"
                    />
                  </div>
                </div>
              </div>

              <div className="actions">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={()=>{
                    setIsOpen(false);
                    setSwapMode(null);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={isLoadingPrice || isSaving}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  {isLoadingPrice || isSaving ? (
                    <>
                      <span className="loading-spinner"></span>
                      {isSaving ? 'Saving...' : 'Loading...'}
                    </>
                  ) : (
                    'Save Transaction'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal transaction-modal" role="dialog" aria-modal="true">
            <div className="card-header">
              <div className="card-title">
                <h3>Edit Transaction</h3>
              </div>
            </div>
            <form onSubmit={saveEdit} className="transaction-form">
              <div className="form-group">
                <label>Type *</label>
                <select 
                  value={editing.type} 
                  onChange={e=>setEditing(v=> v? { ...v, type:e.target.value as TransactionType } : v)}
                  className="form-select"
                >
                  <option value="Deposit">Deposit</option>
                  <option value="Withdrawal">Withdrawal</option>
                  <option value="Swap">Swap</option>
                </select>
              </div>

              {editing.type === 'Swap' && (
                <>
                  <div className="form-group">
                    <label>From Asset</label>
                    <input 
                      placeholder="From Asset" 
                      value={editing.fromAsset ?? ''} 
                      onChange={e=>setEditing(v=> v? { ...v, fromAsset:e.target.value } : v)} 
                      className="form-input"
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>From Quantity</label>
                      <input 
                        type="number" 
                        step="any" 
                        placeholder="From Quantity" 
                        value={editing.fromQuantity ?? ''} 
                        onChange={e=>setEditing(v=> v? { ...v, fromQuantity:e.target.value === ''? null : Number(e.target.value) } : v)} 
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <label>From Price USD</label>
                      <input 
                        type="number" 
                        step="any" 
                        placeholder="From Price USD" 
                        value={editing.fromPriceUsd ?? ''} 
                        onChange={e=>setEditing(v=> v? { ...v, fromPriceUsd:e.target.value === ''? null : Number(e.target.value) } : v)} 
                        className="form-input"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="form-group">
                <label>To Asset *</label>
                <input 
                  placeholder="To Asset" 
                  value={editing.toAsset} 
                  onChange={e=>setEditing(v=> v? { ...v, toAsset:e.target.value } : v)} 
                  required 
                  className="form-input"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>To Quantity *</label>
                  <input 
                    type="number" 
                    step="any" 
                    placeholder="To Quantity" 
                    value={editing.toQuantity} 
                    onChange={e=>setEditing(v=> v? { ...v, toQuantity:Number(e.target.value) } : v)} 
                    required 
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>To Price USD</label>
                  <input 
                    type="number" 
                    step="any" 
                    placeholder="To Price USD" 
                    value={editing.toPriceUsd ?? ''} 
                    onChange={e=>setEditing(v=> v? { ...v, toPriceUsd:e.target.value === ''? null : Number(e.target.value) } : v)} 
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Date & Time *</label>
                  <input 
                    type="datetime-local" 
                    value={editing.datetime && !isNaN(new Date(editing.datetime).getTime()) ? new Date(editing.datetime).toISOString().slice(0,16) : ''} 
                    onChange={e=>setEditing(v=> v? { ...v, datetime:e.target.value } : v)} 
                    required 
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Fees (USD)</label>
                  <input 
                    type="number" 
                    step="any" 
                    placeholder="Fees USD" 
                    value={editing.feesUsd ?? ''} 
                    onChange={e=>setEditing(v=> v? { ...v, feesUsd:e.target.value === ''? null : Number(e.target.value) } : v)} 
                    className="form-input"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <input 
                  placeholder="Notes (optional)" 
                  value={editing.notes ?? ''} 
                  onChange={e=>setEditing(v=> v? { ...v, notes:e.target.value } : v)} 
                  className="form-input"
                />
              </div>

              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={()=>setEditing(null)} disabled={isSaving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    <style jsx>{`
      .transaction-toolbar-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
      }

      .transaction-export-form {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .transaction-import-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        align-items: flex-start;
      }

      .transaction-modal {
        max-width: 800px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
      }

      .transaction-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .form-section {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .form-section-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 2px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .form-section-compact {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      @media (max-width: 768px) {
        .swap-flow-container {
          grid-template-columns: 1fr !important;
        }
        .swap-flow-container > div:not(:last-child) {
          margin-bottom: 16px;
        }
        .swap-arrow {
          transform: rotate(90deg);
          padding: 8px 0 !important;
        }
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .form-group label {
        font-weight: 600;
        color: var(--text);
        font-size: 13px;
      }

      @media (max-width: 768px) {
        .form-section-compact {
          grid-template-columns: 1fr;
        }
      }


      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .form-input, .form-select {
        background: var(--surface);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
        transition: border-color 0.2s ease;
      }

      .form-input:focus, .form-select:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 2px var(--primary)22;
      }

      .error-messages {
        background: #fee2e2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .error-message {
        color: #dc2626;
        font-size: 14px;
        margin-bottom: 4px;
      }

      .error-message:last-child {
        margin-bottom: 0;
      }

      @media (max-width: 768px) {
        .form-row {
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .form-input, .form-select {
          padding: 12px;
          font-size: 16px;
        }
      }
    `}</style>
    </main>
    </AuthGuard>
  );
}

