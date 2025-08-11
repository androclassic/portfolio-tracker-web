'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Portfolio = { id: number; name: string };

type PortfolioContextType = {
  portfolios: Portfolio[];
  selectedId: number | 'all' | null;
  setSelectedId: (id: number | 'all') => void;
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
  const [selectedId, setSelectedIdState] = useState<number | 'all' | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/portfolios', { cache: 'no-store' });
    if (!res.ok) return;
    const rows = await res.json();
    setPortfolios(rows);
    const raw = localStorage.getItem('portfolio:selectedId');
    const firstId = rows[0]?.id ?? null;
    if (raw === 'all') {
      setSelectedIdState('all');
    } else if (raw && !Number.isNaN(Number(raw)) && rows.some((p: Portfolio) => p.id === Number(raw))) {
      setSelectedIdState(Number(raw));
    } else {
      setSelectedIdState(firstId);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setSelectedId = useCallback((id: number | 'all') => {
    setSelectedIdState(id);
    try { localStorage.setItem('portfolio:selectedId', id === 'all' ? 'all' : String(id)); } catch {}
  }, []);

  const value = useMemo<PortfolioContextType>(() => ({ portfolios, selectedId, setSelectedId, refresh: load }), [portfolios, selectedId, setSelectedId, load]);

  return (
    <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>
  );
}


