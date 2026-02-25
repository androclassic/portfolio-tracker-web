import { useState, useEffect, useCallback, useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import { isFiatCurrency } from '@/lib/assets';
import { SupportedAsset } from '@/lib/assets';
import { getTransactionDefaults } from '@/lib/transaction-helpers';
import { fetchHistoricalWithLocalCache } from '@/lib/prices-cache';
import type { Transaction as Tx } from '@/lib/types';

export type TransactionType = 'Deposit' | 'Withdrawal' | 'Swap';

export interface TransactionFormData {
  type: TransactionType;
  fromAsset: string;
  fromQuantity: string;
  fromPriceUsd: string;
  fromSelectedAsset: SupportedAsset | null;
  toAsset: string;
  toQuantity: string;
  toPriceUsd: string;
  toSelectedAsset: SupportedAsset | null;
  fiatCurrency: string;
  fiatAmount: string;
  swapUsdValue: string;
  datetime: string;
  notes: string;
  feesUsd: string;
}

const EMPTY_FORM: TransactionFormData = {
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
};

function buildInitialDataFromTx(tx: Tx): TransactionFormData {
  if (tx.type === 'Deposit') {
    const fiatCurrency = (tx.fromAsset || 'USD').toUpperCase();
    const fiatAmount = (tx.fromQuantity || 0).toString();
    const stablecoinAmount = (tx.toQuantity || 0).toString();
    let exchangeRate = tx.fromPriceUsd;
    if (!exchangeRate || exchangeRate <= 0) {
      const fiat = Number(fiatAmount);
      const stable = Number(stablecoinAmount);
      if (fiat > 0 && stable > 0) {
        exchangeRate = stable / fiat;
      } else {
        exchangeRate = fiatCurrency === 'USD' ? 1.0 : 1.08;
      }
    }
    return {
      ...EMPTY_FORM,
      type: 'Deposit',
      toAsset: tx.toAsset || '',
      toQuantity: stablecoinAmount,
      toPriceUsd: exchangeRate.toString(),
      fiatCurrency,
      fiatAmount,
      datetime: tx.datetime ? new Date(tx.datetime).toISOString().slice(0, 16) : '',
      notes: tx.notes || '',
      feesUsd: tx.feesUsd?.toString() || '',
    };
  }

  if (tx.type === 'Withdrawal') {
    const fiatCurrency = (tx.toAsset || 'USD').toUpperCase();
    const fiatAmount = (tx.toQuantity || 0).toString();
    const stablecoinAmount = (tx.fromQuantity || 0).toString();
    const exchangeRate = tx.toPriceUsd || 1.0;
    return {
      ...EMPTY_FORM,
      type: 'Withdrawal',
      toAsset: tx.fromAsset || '',
      toQuantity: stablecoinAmount,
      toPriceUsd: exchangeRate.toString(),
      fiatCurrency,
      fiatAmount,
      datetime: tx.datetime ? new Date(tx.datetime).toISOString().slice(0, 16) : '',
      notes: tx.notes || '',
      feesUsd: tx.feesUsd?.toString() || '',
    };
  }

  // Swap
  const fromUsd = (tx.fromQuantity || 0) * (tx.fromPriceUsd || 0);
  const toUsd = (tx.toQuantity || 0) * (tx.toPriceUsd || 0);
  const usdValue = fromUsd > 0 ? fromUsd : toUsd;

  return {
    ...EMPTY_FORM,
    type: 'Swap',
    fromAsset: tx.fromAsset || '',
    fromQuantity: (tx.fromQuantity || 0).toString(),
    fromPriceUsd: (tx.fromPriceUsd || 0).toString(),
    toAsset: tx.toAsset || '',
    toQuantity: (tx.toQuantity || 0).toString(),
    toPriceUsd: (tx.toPriceUsd || 0).toString(),
    swapUsdValue: usdValue.toString(),
    datetime: tx.datetime ? new Date(tx.datetime).toISOString().slice(0, 16) : '',
    notes: tx.notes || '',
    feesUsd: tx.feesUsd?.toString() || '',
  };
}

// Synchronous recalculation - replaces all cascading useEffects
function recalculate(data: TransactionFormData, changedField: string): TransactionFormData {
  const result = { ...data };

  if (result.type === 'Swap') {
    // Determine if from/to are stablecoins for auto USD value
    const fromIsStable = result.fromAsset ? isStablecoin(result.fromAsset) : false;
    const toIsStable = result.toAsset ? isStablecoin(result.toAsset) : false;

    // Auto-calculate swapUsdValue from stablecoin amounts
    if (changedField === 'fromQuantity' || changedField === 'fromAsset') {
      if (fromIsStable && result.fromQuantity) {
        const qty = Number(result.fromQuantity);
        if (qty > 0) {
          result.swapUsdValue = qty.toFixed(2);
        }
      }
    }
    if (changedField === 'toQuantity' || changedField === 'toAsset') {
      if (toIsStable && !fromIsStable && result.toQuantity) {
        const qty = Number(result.toQuantity);
        if (qty > 0) {
          result.swapUsdValue = qty.toFixed(2);
        }
      }
    }

    // Calculate per-unit prices from swapUsdValue
    const usdValue = Number(result.swapUsdValue) || 0;
    if (usdValue > 0) {
      const fromQty = Number(result.fromQuantity) || 0;
      const toQty = Number(result.toQuantity) || 0;

      if (fromQty > 0) {
        const price = usdValue / fromQty;
        result.fromPriceUsd = price.toFixed(8).replace(/\.?0+$/, '');
      }
      if (toQty > 0) {
        const price = usdValue / toQty;
        result.toPriceUsd = price.toFixed(8).replace(/\.?0+$/, '');
      }
    }
  }

  if (result.type === 'Deposit') {
    result.toPriceUsd = '1.0'; // Stablecoin is always $1
    const fiatAmount = Number(result.fiatAmount) || 0;
    const stablecoinAmount = Number(result.toQuantity) || 0;
    if (fiatAmount > 0 && stablecoinAmount > 0) {
      // Exchange rate auto-calculated but not editable
    }
  }

  if (result.type === 'Withdrawal') {
    const fiatAmount = Number(result.fiatAmount) || 0;
    const stablecoinAmount = Number(result.toQuantity) || 0;
    if (fiatAmount > 0 && stablecoinAmount > 0) {
      // Exchange rate auto-calculated but not editable
    }
  }

  return result;
}

async function getHistoricalPriceForDate(symbol: string, date: string): Promise<number | null> {
  if (!date) return null;
  try {
    const dateObj = new Date(date);
    const dateStr = dateObj.toISOString().split('T')[0];
    const unixSec = Math.floor(dateObj.getTime() / 1000);
    const startUnix = unixSec - (7 * 24 * 60 * 60);
    const endUnix = unixSec + (7 * 24 * 60 * 60);
    const histData = await fetchHistoricalWithLocalCache([symbol.toUpperCase()], startUnix, endUnix);
    let pricePoint = histData.prices.find(p => p.asset === symbol.toUpperCase() && p.date === dateStr);
    if (!pricePoint && histData.prices.length > 0) {
      const relevantPrices = histData.prices
        .filter(p => p.asset === symbol.toUpperCase())
        .sort((a, b) => Math.abs(new Date(a.date).getTime() - dateObj.getTime()) - Math.abs(new Date(b.date).getTime() - dateObj.getTime()));
      pricePoint = relevantPrices[0];
    }
    return pricePoint ? pricePoint.price_usd : null;
  } catch {
    return null;
  }
}

export interface UseTransactionFormOptions {
  editingTransaction?: Tx | null;
  currentHoldings: Record<string, number>;
}

export function useTransactionForm({ editingTransaction, currentHoldings }: UseTransactionFormOptions) {
  const [formData, setFormData] = useState<TransactionFormData>(() => {
    if (editingTransaction) {
      return buildInitialDataFromTx(editingTransaction);
    }
    return { ...EMPTY_FORM };
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(() => {
    // Show more options by default if editing and has fees or notes
    if (editingTransaction) {
      return !!(editingTransaction.feesUsd || editingTransaction.notes);
    }
    return false;
  });

  // Auto-fill datetime on mount for new transactions
  useEffect(() => {
    if (!editingTransaction && !formData.datetime) {
      getTransactionDefaults(null).then(defaults => {
        setFormData(prev => ({ ...prev, datetime: prev.datetime || defaults.datetime }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Async: fetch historical price for crypto-to-crypto swaps when date or asset changes
  useEffect(() => {
    if (formData.type !== 'Swap') return;
    if (!formData.datetime || !formData.fromAsset) return;
    if (isStablecoin(formData.fromAsset) || isFiatCurrency(formData.fromAsset)) return;
    if (!formData.fromQuantity || Number(formData.fromQuantity) <= 0) return;

    let cancelled = false;
    const dateStr = formData.datetime.split('T')[0];

    getHistoricalPriceForDate(formData.fromAsset, dateStr).then(price => {
      if (cancelled || !price || price <= 0) return;
      const qty = Number(formData.fromQuantity);
      if (qty <= 0) return;
      const calculatedUsd = (qty * price).toFixed(2);

      setFormData(prev => {
        // Only update if user hasn't manually set a significantly different value
        const currentUsd = Number(prev.swapUsdValue) || 0;
        const newUsd = Number(calculatedUsd);
        if (prev.swapUsdValue && Math.abs(currentUsd - newUsd) / newUsd > 0.05) {
          return prev; // User has manually changed it, don't override
        }
        return recalculate({ ...prev, swapUsdValue: calculatedUsd }, 'swapUsdValue');
      });
    });

    return () => { cancelled = true; };
  }, [formData.type, formData.datetime, formData.fromAsset, formData.fromQuantity]);

  const setField = useCallback((field: keyof TransactionFormData, value: string) => {
    setFieldErrors(prev => {
      if (prev[field]) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return prev;
    });
    setFormData(prev => recalculate({ ...prev, [field]: value }, field));
  }, []);

  const setType = useCallback((type: TransactionType) => {
    setFieldErrors({});
    setGlobalErrors([]);
    setFormData(prev => ({
      ...EMPTY_FORM,
      type,
      // Preserve these across type switches
      datetime: prev.datetime,
      notes: prev.notes,
      feesUsd: prev.feesUsd,
      fiatCurrency: (type === 'Deposit' || type === 'Withdrawal') ? (prev.fiatCurrency || 'USD') : 'USD',
    }));
  }, []);

  const handleAssetSelection = useCallback(async (side: 'from' | 'to', asset: SupportedAsset | null, symbol: string) => {
    // For Deposit/Withdrawal, validate stablecoin-only on the 'to' side
    if ((formData.type === 'Deposit' || formData.type === 'Withdrawal') && side === 'to' && asset && !isStablecoin(symbol)) {
      setGlobalErrors([`For ${formData.type} transactions, only stablecoins are allowed.`]);
      return;
    }

    if (!asset) {
      const field = side === 'from' ? 'fromAsset' : 'toAsset';
      setFormData(prev => recalculate({ ...prev, [field]: symbol.toUpperCase() }, field));
      return;
    }

    setIsLoadingPrice(true);
    setGlobalErrors([]);

    try {
      const defaults = await getTransactionDefaults(asset);
      setFormData(prev => {
        const updates: Partial<TransactionFormData> = {
          [`${side}Asset`]: symbol.toUpperCase(),
          [`${side}SelectedAsset`]: asset,
          datetime: prev.datetime || defaults.datetime,
        };

        if (side === 'from' && formData.type === 'Swap') {
          updates.fromPriceUsd = defaults.priceUsd;
          const qty = Number(prev.fromQuantity) || 0;
          if (qty > 0 && defaults.priceUsd) {
            updates.swapUsdValue = prev.swapUsdValue || (qty * Number(defaults.priceUsd)).toFixed(2);
          }
        } else if (side === 'to' && formData.type === 'Swap') {
          updates.toPriceUsd = defaults.priceUsd;
        }

        return recalculate({ ...prev, ...updates } as TransactionFormData, `${side}Asset`);
      });
    } catch (error) {
      console.error('Failed to get transaction defaults:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  }, [formData.type]);

  // Auto-detect swap mode from assets
  const detectedSwapMode = useMemo((): 'buy' | 'sell' | 'swap' | null => {
    if (formData.type !== 'Swap') return null;
    if (!formData.fromAsset && !formData.toAsset) return null;

    const fromIsStable = formData.fromAsset ? isStablecoin(formData.fromAsset) : false;
    const toIsStable = formData.toAsset ? isStablecoin(formData.toAsset) : false;

    if (fromIsStable && !toIsStable && formData.toAsset) return 'buy';
    if (!fromIsStable && toIsStable && formData.fromAsset) return 'sell';
    return 'swap';
  }, [formData.type, formData.fromAsset, formData.toAsset]);

  // Computed exchange rate hint for Deposit/Withdrawal
  const exchangeRateHint = useMemo((): string | null => {
    if (formData.type === 'Deposit') {
      const fiat = Number(formData.fiatAmount) || 0;
      const stable = Number(formData.toQuantity) || 0;
      if (fiat > 0 && stable > 0) {
        const rate = stable / fiat;
        return `Exchange rate: 1 ${formData.fiatCurrency} = ${rate.toFixed(4)} USD`;
      }
    }
    if (formData.type === 'Withdrawal') {
      const fiat = Number(formData.fiatAmount) || 0;
      const stable = Number(formData.toQuantity) || 0;
      if (fiat > 0 && stable > 0) {
        const rate = fiat / stable;
        return `Exchange rate: 1 USD = ${rate.toFixed(4)} ${formData.fiatCurrency}`;
      }
    }
    return null;
  }, [formData.type, formData.fiatAmount, formData.toQuantity, formData.fiatCurrency]);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.datetime) {
      errors.datetime = 'Date & time is required';
    }

    if (formData.type === 'Swap') {
      if (!formData.fromAsset) errors.fromAsset = 'Select an asset';
      if (!formData.fromQuantity || Number(formData.fromQuantity) <= 0) errors.fromQuantity = 'Enter a quantity';
      if (!formData.toAsset) errors.toAsset = 'Select an asset';
      if (!formData.toQuantity || Number(formData.toQuantity) <= 0) errors.toQuantity = 'Enter a quantity';
    } else {
      // Deposit/Withdrawal
      if (!formData.toAsset) errors.toAsset = 'Select a stablecoin';
      if (!formData.toQuantity || Number(formData.toQuantity) <= 0) errors.toQuantity = 'Enter an amount';
      if (!isStablecoin(formData.toAsset) && formData.toAsset) errors.toAsset = 'Must be a stablecoin';
      if (!formData.fiatCurrency) errors.fiatCurrency = 'Select a currency';
      if (!formData.fiatAmount || Number(formData.fiatAmount) <= 0) errors.fiatAmount = 'Enter an amount';

      if (formData.type === 'Withdrawal') {
        const toAssetUpper = formData.toAsset.toUpperCase();
        const balance = currentHoldings[toAssetUpper] || 0;
        const qty = Number(formData.toQuantity);
        if (qty > balance) {
          errors.toQuantity = `Insufficient balance (available: ${balance.toFixed(4)})`;
        }
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData, currentHoldings]);

  const reset = useCallback(() => {
    setFormData({ ...EMPTY_FORM });
    setFieldErrors({});
    setGlobalErrors([]);
    setShowMoreOptions(false);
  }, []);

  return {
    formData,
    fieldErrors,
    globalErrors,
    setGlobalErrors,
    isLoadingPrice,
    showMoreOptions,
    setShowMoreOptions,
    setField,
    setType,
    handleAssetSelection,
    detectedSwapMode,
    exchangeRateHint,
    validate,
    reset,
    currentHoldings,
  };
}

export type UseTransactionFormReturn = ReturnType<typeof useTransactionForm>;
