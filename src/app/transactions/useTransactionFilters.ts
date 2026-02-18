'use client';
import { useMemo, useState } from 'react';
import type { Transaction as Tx } from '@/lib/types';

export type SortDir = 'asc' | 'desc';

const DEFAULT_PAGE_SIZE = 25;

export function useTransactionFilters(txs: Tx[] | undefined) {
  const [assetFilter, setAssetFilterRaw] = useState('All');
  const [typeFilter, setTypeFilterRaw] = useState('All');
  const [sortDir, setSortDirRaw] = useState<SortDir>('desc');
  const [search, setSearchRaw] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(DEFAULT_PAGE_SIZE);

  // Auto-reset to page 1 when any filter changes
  const resetPage = () => setPage(1);
  const setAssetFilter = (v: string) => { setAssetFilterRaw(v); resetPage(); };
  const setTypeFilter = (v: string) => { setTypeFilterRaw(v); resetPage(); };
  const setSortDir = (v: SortDir) => { setSortDirRaw(v); resetPage(); };
  const setSearch = (v: string) => { setSearchRaw(v); resetPage(); };
  const setPageSize = (v: number) => { setPageSizeRaw(v); resetPage(); };

  const filteredAndSorted = useMemo(() => {
    const list = (txs || []).filter(t => {
      // Asset filter
      if (assetFilter !== 'All') {
        const a = assetFilter.toUpperCase();
        if (t.toAsset.toUpperCase() !== a && (!t.fromAsset || t.fromAsset.toUpperCase() !== a)) {
          return false;
        }
      }
      // Type filter
      if (typeFilter !== 'All' && t.type !== typeFilter) return false;

      // Search (asset names + notes)
      if (search) {
        const q = search.toLowerCase();
        const hay = [t.toAsset, t.fromAsset ?? '', t.notes ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    return list.sort((a, b) =>
      sortDir === 'asc'
        ? new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
        : new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
    );
  }, [txs, assetFilter, typeFilter, sortDir, search]);

  const totalFiltered = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  // Clamp page if filters reduced totalPages below current page
  const safePage = Math.min(page, totalPages);

  const rows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSorted.slice(start, start + pageSize);
  }, [filteredAndSorted, safePage, pageSize]);

  const hasActiveFilters = assetFilter !== 'All' || typeFilter !== 'All' || search !== '';

  const clearAllFilters = () => {
    setAssetFilterRaw('All');
    setTypeFilterRaw('All');
    setSearchRaw('');
    resetPage();
  };

  return {
    rows,
    totalFiltered,
    totalPages,
    hasActiveFilters,
    clearAllFilters,
    state: { assetFilter, typeFilter, sortDir, search, page: safePage, pageSize },
    setAssetFilter,
    setTypeFilter,
    setSortDir,
    setSearch,
    setPage,
    setPageSize,
  };
}
