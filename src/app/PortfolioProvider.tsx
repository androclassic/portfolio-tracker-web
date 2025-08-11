'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Portfolio = { id: number; name: string };

type PortfolioContextType = {
  portfolios: Portfolio[];
  selectedId: number | null;
  setSelectedId: (id: number) => void;
  refresh: () => Promise<void>;
};

const PortfolioContext = createContext<PortfolioContextType | undefined>(undefined);

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used within PortfolioProvider');
  return ctx;
}

export default function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selectedId, setSelectedIdState] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/portfolios', { cache: 'no-store' });
    if (!res.ok) return;
    const rows = await res.json();
    setPortfolios(rows);
    const stored = Number(localStorage.getItem('portfolio:selectedId') || '');
    const firstId = rows[0]?.id ?? null;
    setSelectedIdState(Number.isFinite(stored) && rows.some((p: Portfolio) => p.id === stored) ? stored : firstId);
  }, []);

  useEffect(() => { load(); }, [load]);

  const setSelectedId = useCallback((id: number) => {
    setSelectedIdState(id);
    try { localStorage.setItem('portfolio:selectedId', String(id)); } catch {}
  }, []);

  const value = useMemo<PortfolioContextType>(() => ({ portfolios, selectedId, setSelectedId, refresh: load }), [portfolios, selectedId, setSelectedId, load]);

  return (
    <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>
  );
}


