import { getHistoricalExchangeRate } from '@/lib/exchange-rates';
import { isStablecoin } from '@/lib/assets';
import type { TransactionFormData, TransactionType } from './useTransactionForm';

export interface TransactionPayload {
  id?: number;
  type: TransactionType;
  toAsset: string;
  toQuantity: number;
  toPriceUsd: number | null;
  datetime: string;
  notes: string | null;
  feesUsd: number | null;
  portfolioId: number;
  fromAsset?: string | null;
  fromQuantity?: number | null;
  fromPriceUsd?: number | null;
}

export async function buildTransactionPayload(
  formData: TransactionFormData,
  portfolioId: number,
  editingId?: number
): Promise<TransactionPayload> {
  const payload: TransactionPayload = {
    type: formData.type,
    toAsset: formData.toAsset,
    toQuantity: Number(formData.toQuantity),
    toPriceUsd: formData.toPriceUsd ? Number(formData.toPriceUsd) : null,
    datetime: formData.datetime,
    notes: formData.notes || null,
    feesUsd: formData.feesUsd ? Number(formData.feesUsd) : null,
    portfolioId,
  };

  if (editingId !== undefined) {
    payload.id = editingId;
  }

  if (formData.type === 'Swap') {
    payload.fromAsset = formData.fromAsset;
    payload.fromQuantity = formData.fromQuantity ? Number(formData.fromQuantity) : null;
    payload.fromPriceUsd = formData.fromPriceUsd ? Number(formData.fromPriceUsd) : null;
  } else if (formData.type === 'Deposit') {
    // Deposit: fromAsset = fiat currency, fromQuantity = fiat amount
    payload.fromAsset = formData.fiatCurrency.toUpperCase();
    payload.fromQuantity = Number(formData.fiatAmount);
    payload.toAsset = formData.toAsset;
    payload.toQuantity = Number(formData.toQuantity);
    payload.toPriceUsd = 1.0; // Stablecoin price is always 1.0

    // Calculate fiat price (exchange rate)
    const fiatAmount = Number(formData.fiatAmount);
    const stablecoinAmount = Number(formData.toQuantity);
    if (fiatAmount > 0 && stablecoinAmount > 0) {
      payload.fromPriceUsd = stablecoinAmount / fiatAmount;
    } else if (formData.fiatCurrency.toUpperCase() === 'USD') {
      payload.fromPriceUsd = 1.0;
    } else {
      try {
        const txDate = formData.datetime ? formData.datetime.split('T')[0] : new Date().toISOString().split('T')[0];
        payload.fromPriceUsd = await getHistoricalExchangeRate('EUR', 'USD', txDate);
      } catch {
        payload.fromPriceUsd = 1.08;
      }
    }
  } else if (formData.type === 'Withdrawal') {
    // Withdrawal: fromAsset = stablecoin, fromQuantity = stablecoin amount
    payload.fromAsset = formData.toAsset; // The stablecoin being withdrawn
    payload.fromQuantity = Number(formData.toQuantity);
    payload.fromPriceUsd = 1.0; // Stablecoins are always $1

    // toAsset = fiat currency, toQuantity = fiat amount
    payload.toAsset = formData.fiatCurrency.toUpperCase();
    payload.toQuantity = Number(formData.fiatAmount);

    if (formData.fiatCurrency.toUpperCase() === 'USD') {
      payload.toPriceUsd = 1.0;
    } else {
      try {
        const txDate = formData.datetime ? formData.datetime.split('T')[0] : new Date().toISOString().split('T')[0];
        payload.toPriceUsd = await getHistoricalExchangeRate('EUR', 'USD', txDate);
      } catch {
        payload.toPriceUsd = 1.08;
      }
    }
  }

  return payload;
}

export function parseApiErrors(errorData: unknown): string[] {
  if (!errorData || typeof errorData !== 'object') {
    return ['Failed to save transaction'];
  }

  const data = errorData as Record<string, unknown>;

  if (typeof data === 'string') {
    return [data];
  }

  if (data.error) {
    if (typeof data.error === 'object' && data.error !== null) {
      const zodError = data.error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      if (zodError.formErrors && Array.isArray(zodError.formErrors)) {
        return zodError.formErrors;
      }
      if (zodError.fieldErrors && typeof zodError.fieldErrors === 'object') {
        return Object.entries(zodError.fieldErrors)
          .flatMap(([field, fieldErrs]) =>
            Array.isArray(fieldErrs)
              ? fieldErrs.map(err => `${field}: ${err}`)
              : [`${field}: ${String(fieldErrs)}`]
          );
      }
      return ['Invalid transaction data'];
    }
    if (typeof data.error === 'string') {
      return [data.error];
    }
    return ['Failed to save transaction'];
  }

  if (data.formErrors && Array.isArray(data.formErrors)) {
    return data.formErrors as string[];
  }

  if (data.fieldErrors && typeof data.fieldErrors === 'object') {
    return Object.entries(data.fieldErrors as Record<string, string[]>)
      .flatMap(([field, fieldErrs]) =>
        Array.isArray(fieldErrs)
          ? fieldErrs.map(err => `${field}: ${err}`)
          : [`${field}: ${String(fieldErrs)}`]
      );
  }

  if (typeof data.message === 'string') {
    return [data.message];
  }

  return ['Failed to save transaction'];
}
