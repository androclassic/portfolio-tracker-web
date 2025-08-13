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
    let loaded: Portfolio[] = [];
    try {
      const res = await fetch('/api/portfolios', { cache: 'no-store' });
      const ct = res.headers.get('content-type') || '';
      
      // Handle authentication errors gracefully
      if (res.status === 401) {
        console.log('Portfolio API: Not authenticated, setting empty portfolios');
        setPortfolios([]);
        setSelectedIdState(null);
        return;
      }
      
      if (!res.ok || !ct.includes('application/json')) return;
      loaded = await res.json();
      setPortfolios(loaded);
    } catch (err) {
      console.log('Portfolio API error:', err);
      return;
    }
    const raw = localStorage.getItem('portfolio:selectedId');
    const firstId = loaded[0]?.id ?? null;
    if (raw === 'all') {
      setSelectedIdState('all');
    } else if (raw && !Number.isNaN(Number(raw)) && loaded.some((p: Portfolio) => p.id === Number(raw))) {
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


