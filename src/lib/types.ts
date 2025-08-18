export type Transaction = {
  id: number;
  asset: string;
  type: 'Buy' | 'Sell';
  priceUsd?: number | null;
  quantity: number;
  datetime: string;
  costUsd?: number | null;
  proceedsUsd?: number | null;
  notes?: string | null;
};

export type PricePoint = { date: string; asset: string; price_usd: number };

export type PricesResp = { prices: Record<string, number> };

export type HistResp = { prices: PricePoint[] };


