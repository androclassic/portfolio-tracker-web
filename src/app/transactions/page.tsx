'use client';
import useSWR, { useSWRConfig } from 'swr';
import { useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor } from '@/lib/assets';
import CryptoIcon from '../components/CryptoIcon';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';
import { TransactionHelpers } from '@/lib/types';
import { calculateHoldings } from '@/lib/portfolio-utils';
import AuthGuard from '@/components/AuthGuard';
import { useIsMobile } from '@/hooks/useMediaQuery';
import TransactionModal from './TransactionModal';
import { useTransactionFilters } from './useTransactionFilters';
import TransactionPagination from './TransactionPagination';

const fetcher = jsonFetcher;

// Hoisted formatters — created once at module load, not every render
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const df = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dfDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dfTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

export default function TransactionsPage() {
  const { selectedId } = usePortfolio();
  const swrKey = selectedId === 'all' ? '/api/transactions' : (selectedId ? `/api/transactions?portfolioId=${selectedId}` : null);
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
      if (!freshRes.ok) throw new Error('Failed to fetch fresh data');
      freshData = await freshRes.json();

      if (deletedId !== undefined && freshData) {
        const stillExists = freshData.some(tx => tx.id === deletedId);
        if (!stillExists) break;
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

  const [isOpen, setIsOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Tx | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const filters = useTransactionFilters(txs);

  const assets = useMemo(() => {
    const s = new Set<string>();
    (txs || []).forEach(t => {
      if (t.fromAsset) s.add(t.fromAsset.toUpperCase());
      s.add(t.toAsset.toUpperCase());
    });
    return ['All', ...Array.from(s).sort()];
  }, [txs]);

  const currentHoldings = useMemo(() => {
    if (!txs) return {};
    return calculateHoldings(txs);
  }, [txs]);

  // Show fees column only if any transaction has fees
  const showFeesCol = useMemo(() => {
    return (txs || []).some(t => t.feesUsd && t.feesUsd > 0);
  }, [txs]);

  async function removeTx(id: number) {
    if (!confirm('Delete this transaction?')) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/transactions?id=${id}`, { method: 'DELETE' });
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

  const isMobile = useIsMobile();
  const portfolioId = (typeof selectedId === 'number' ? selectedId : null) ?? 1;
  const colCount = 6 + (isMobile ? 0 : 1) + (showFeesCol && !isMobile ? 1 : 0);

  return (
    <AuthGuard redirectTo="/transactions">
      <main>
        <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', fontSize: '2rem', fontWeight: 800 }}>
            Transaction Management
          </h1>
          <p className="subtitle" style={{ fontSize: '1rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
            Track and manage all your cryptocurrency transactions
          </p>
        </div>

        <div className="toolbar">
          <div className="filters">
            <label>Asset
              <select value={filters.state.assetFilter} onChange={e => filters.setAssetFilter(e.target.value)}>
                {assets.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label>Type
              <select value={filters.state.typeFilter} onChange={e => filters.setTypeFilter(e.target.value)}>
                <option value="All">All</option>
                <option value="Deposit">Deposit</option>
                <option value="Withdrawal">Withdrawal</option>
                <option value="Swap">Swap</option>
              </select>
            </label>
            <label>Sort by date
              <select value={filters.state.sortDir} onChange={e => filters.setSortDir(e.target.value as 'asc' | 'desc')}>
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </label>
            <label>Search
              <input
                type="text"
                placeholder="Asset or note..."
                value={filters.state.search}
                onChange={e => filters.setSearch(e.target.value)}
                style={{ minWidth: '140px' }}
              />
            </label>
          </div>
          <div className="transaction-toolbar-actions">
            <button
              className="btn btn-primary"
              onClick={() => setIsOpen(true)}
              disabled={isSaving}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}
            >
              Add Transaction
            </button>
            {selectedId && (
              <>
                <button
                  onClick={async () => {
                    const url = `/api/transactions/export?portfolioId=${selectedId}&format=default`;
                    try {
                      const response = await fetch(url, { method: 'POST' });
                      if (response.ok) {
                        const blob = await response.blob();
                        const downloadUrl = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = downloadUrl;
                        a.download = `transactions_portfolio_${selectedId}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(downloadUrl);
                      }
                    } catch (error) {
                      console.error('Export failed:', error);
                    }
                  }}
                  className="btn btn-success"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  Export CSV
                </button>
                <button
                  onClick={() => {
                    const sampleCsv = `type,datetime,from_asset,from_quantity,from_price_usd,to_asset,to_quantity,to_price_usd,fees_usd,notes
Deposit,2024-01-15T10:30:00Z,USD,5000,1,BTC,0.1,50000,25,Initial deposit - buying BTC with USD
Swap,2024-01-20T14:20:00Z,BTC,0.05,52000,ETH,8.5,3058.82,15,Swapped half BTC for ETH
Deposit,2024-02-01T09:15:00Z,USD,3000,1,ETH,1.0,3000,20,Added more ETH with USD
Swap,2024-02-15T16:45:00Z,ETH,5.0,3200,BTC,0.08,200000,18,Swapped ETH back to BTC
Withdrawal,2024-02-28T11:00:00Z,BTC,0.05,55000,USD,2750,1,12,Withdrew some BTC to USD`;
                    const blob = new Blob([sampleCsv], { type: 'text/csv' });
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    a.download = 'sample_transactions.csv';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(downloadUrl);
                  }}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  Download Sample CSV
                </button>
                <div className="transaction-import-wrapper">
                  <label
                    className="btn btn-secondary"
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}
                  >
                    Import CSV
                    <input type="file" accept=".csv" style={{ display: 'none' }} onChange={async (e) => {
                      const file = e.target.files?.[0]; if (!file) return;
                      setIsSaving(true);
                      try {
                        const fd = new FormData(); fd.append('file', file);
                        const res = await fetch(`/api/transactions/import?portfolioId=${selectedId}`, { method: 'POST', body: fd });
                        if (res.ok) {
                          const result = await res.json();
                          if (result.warnings) {
                            alert(`Import completed with warnings:\n${result.warnings.message}\n\nImported: ${result.imported} transactions`);
                          } else {
                            alert(`Successfully imported ${result.imported} transactions`);
                          }
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

        {/* Active filters summary */}
        {filters.hasActiveFilters && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
              {filters.totalFiltered} of {txs?.length ?? 0} transactions
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={filters.clearAllFilters}
              style={{ fontSize: '0.8rem', padding: '2px 10px' }}
            >
              Clear filters
            </button>
          </div>
        )}

        {isSaving && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, cursor: 'wait'
          }}>
            <div style={{
              backgroundColor: 'var(--surface)', padding: '2rem', borderRadius: '12px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem'
            }}>
              <div className="loading-spinner" style={{ width: '40px', height: '40px' }}></div>
              <div style={{ fontSize: '1rem', fontWeight: 600 }}>Saving transaction...</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Please wait while we update the database</div>
            </div>
          </div>
        )}

        <section className="card">
          <TransactionPagination
            page={filters.state.page}
            totalPages={filters.totalPages}
            totalFiltered={filters.totalFiltered}
            pageSize={filters.state.pageSize}
            onPage={filters.setPage}
            onPageSize={filters.setPageSize}
          />

          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  {!isMobile && <th>Value</th>}
                  {showFeesCol && !isMobile && <th>Fees</th>}
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filters.rows.map(t => {
                  const toValue = TransactionHelpers.getToValueUsd(t);
                  return (
                    <tr key={t.id}>
                      <td style={{ color: 'var(--muted)', fontSize: '0.9rem', ...(isMobile ? {} : { whiteSpace: 'nowrap' }) }}>
                        {isMobile ? (
                          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4' }}>
                            <span>{dfDate.format(new Date(t.datetime))}</span>
                            <span style={{ fontSize: '0.85em', opacity: 0.8 }}>{dfTime.format(new Date(t.datetime))}</span>
                          </div>
                        ) : (
                          df.format(new Date(t.datetime))
                        )}
                      </td>
                      <td>
                        <span className={`transaction-type-badge ${t.type.toLowerCase()}`}>
                          {t.type}
                        </span>
                      </td>
                      <td>
                        {t.fromAsset ? (
                          <span style={{ display: 'inline-flex', gap: 6, flexDirection: 'column', alignItems: 'flex-start' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <CryptoIcon symbol={t.fromAsset} size={18} alt={`${t.fromAsset} logo`} />
                              <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: `${getAssetColor(t.fromAsset)}22`, color: getAssetColor(t.fromAsset), fontWeight: 600 }}>
                                {t.fromAsset.toUpperCase()}
                              </span>
                            </span>
                            <span style={{ fontSize: '0.9em', color: 'var(--muted)' }}>{t.fromQuantity ? nf.format(t.fromQuantity) : ''} @ ${t.fromPriceUsd ? nf.format(t.fromPriceUsd) : ''}</span>
                          </span>
                        ) : '-'}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: 6, flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <CryptoIcon symbol={t.toAsset} size={18} alt={`${t.toAsset} logo`} />
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, background: `${getAssetColor(t.toAsset)}22`, color: getAssetColor(t.toAsset), fontWeight: 600 }}>
                              {t.toAsset.toUpperCase()}
                            </span>
                          </span>
                          <span style={{ fontSize: '0.85em', color: 'var(--muted)', marginTop: '2px' }}>
                            {nf.format(t.toQuantity)} {t.toPriceUsd ? `@ $${nf.format(t.toPriceUsd)}` : ''}
                          </span>
                        </span>
                      </td>
                      {!isMobile && (
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                          {toValue > 0 ? usdFmt.format(toValue) : <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>{'\u2014'}</span>}
                        </td>
                      )}
                      {showFeesCol && !isMobile && (
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: '0.9rem' }}>
                          {t.feesUsd && t.feesUsd > 0 ? usdFmt.format(t.feesUsd) : <span style={{ fontStyle: 'italic', opacity: 0.5 }}>{'\u2014'}</span>}
                        </td>
                      )}
                      <td style={{ color: 'var(--muted)', fontSize: '0.9rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.notes || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>{'\u2014'}</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => setEditingTx(t)}
                            disabled={isSaving}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '6px 12px' }}
                            title="Edit transaction"
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => removeTx(t.id)}
                            disabled={isSaving}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '6px 12px' }}
                            title="Delete transaction"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filters.rows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>No transactions found</div>
                        <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Try adjusting your filters or add a new transaction</div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <TransactionPagination
            page={filters.state.page}
            totalPages={filters.totalPages}
            totalFiltered={filters.totalFiltered}
            pageSize={filters.state.pageSize}
            onPage={filters.setPage}
            onPageSize={filters.setPageSize}
          />
        </section>

        {/* Add Transaction Modal */}
        {isOpen && (
          <TransactionModal
            mode="add"
            currentHoldings={currentHoldings}
            portfolioId={portfolioId}
            onClose={() => setIsOpen(false)}
            onSaved={() => forceRefresh()}
          />
        )}

        {/* Edit Transaction Modal */}
        {editingTx && (
          <TransactionModal
            mode="edit"
            editingTransaction={editingTx}
            currentHoldings={currentHoldings}
            portfolioId={portfolioId}
            onClose={() => setEditingTx(null)}
            onSaved={() => forceRefresh()}
          />
        )}

        <style jsx>{`
          .transaction-toolbar-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-end;
            gap: 0.5rem;
          }

          .transaction-import-wrapper {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
            align-items: flex-start;
          }
        `}</style>
      </main>
    </AuthGuard>
  );
}
