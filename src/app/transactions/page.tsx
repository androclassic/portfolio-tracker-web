'use client';
import useSWR, { useSWRConfig } from 'swr';
import { useMemo, useState, useEffect } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { convertFiat, getAssetColor, getFiatCurrencies, isFiatCurrency, isStablecoin, SUPPORTED_ASSETS } from '@/lib/assets';
import AssetInput from '../components/AssetInput';
import CryptoIcon from '../components/CryptoIcon';
import { SupportedAsset } from '../../lib/assets';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';
import { getTransactionDefaults, validateTransaction, formatPrice, calculateTransactionValue } from '../../lib/transaction-helpers';
import AuthGuard from '@/components/AuthGuard';

const fetcher = jsonFetcher;

// Transaction type moved to lib/types

export default function TransactionsPage(){
  const { selectedId } = usePortfolio();
  const swrKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs } = useSWR<Tx[]>(swrKey, fetcher);
  const { mutate } = useSWRConfig();
  const [assetFilter, setAssetFilter] = useState<string>('All');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [isOpen, setIsOpen] = useState(false);
  const [newTx, setNewTx] = useState<{
    asset: string;
    type: 'Buy'|'Sell'|'Deposit'|'Withdrawal'|string;
    quantity: string;
    priceUsd: string;
    datetime: string;
    notes?: string;
    selectedAsset: SupportedAsset | null;
    settlementStable: string;
  }>({ 
    asset:'', 
    type:'Buy', 
    quantity:'', 
    priceUsd:'', 
    datetime:'', 
    notes:'',
    selectedAsset: null,
    settlementStable: 'USDT',
  });
  const [txErrors, setTxErrors] = useState<string[]>([]);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [editing, setEditing] = useState<Tx|null>(null);

  // Using centralized asset colors from lib/assets

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=>s.add(t.asset.toUpperCase()));
    return ['All', ...Array.from(s).sort()];
  }, [txs]);

  const filtered = useMemo(()=>{
    const list = (txs||[]).filter(t=> assetFilter==='All' ? true : t.asset.toUpperCase()===assetFilter);
    return list.sort((a,b)=> sortDir==='asc' ? new Date(a.datetime).getTime()-new Date(b.datetime).getTime() : new Date(b.datetime).getTime()-new Date(a.datetime).getTime());
  }, [txs, assetFilter, sortDir]);

  // Auto-fill current data when opening modal
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

  // Handle asset selection and auto-fill price
  const handleAssetSelection = async (asset: SupportedAsset | null, symbol: string) => {
    setIsLoadingPrice(true);
    setTxErrors([]);
    
    try {
      const defaults = await getTransactionDefaults(asset);
      setNewTx(prev => ({
        ...prev,
        asset: symbol.toUpperCase(),
        selectedAsset: asset,
        priceUsd: defaults.priceUsd,
        datetime: prev.datetime || defaults.datetime
      }));
    } catch (error) {
      console.error('Failed to get transaction defaults:', error);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  // Calculate cost/proceeds when quantity or price changes
  const calculatedValues = useMemo(() => {
    if (newTx.quantity && newTx.priceUsd && (newTx.type === 'Buy' || newTx.type === 'Sell')) {
      return calculateTransactionValue(
        newTx.type as 'Buy' | 'Sell',
        newTx.quantity,
        newTx.priceUsd
      );
    }
    return {};
  }, [newTx.quantity, newTx.priceUsd, newTx.type]);

  async function addTx(e: React.FormEvent){
    e.preventDefault();
    setTxErrors([]);
    
    // Validate transaction data
    const validation = validateTransaction({
      asset: newTx.asset,
      type: newTx.type,
      quantity: newTx.quantity,
      priceUsd: newTx.priceUsd,
      datetime: newTx.datetime
    });
    
    if (!validation.isValid) {
      setTxErrors(validation.errors);
      return;
    }
    
    // Check if asset is supported
    if (!newTx.selectedAsset && !isFiatCurrency(newTx.asset)) {
      setTxErrors(['Please select a supported cryptocurrency from the dropdown']);
      return;
    }
    
    const stablecoins = SUPPORTED_ASSETS.filter(a => a.category === 'stablecoin').map(a => a.symbol.toUpperCase());
    const settlementStable = (newTx.settlementStable || 'USDT').toUpperCase();

    if (!stablecoins.includes(settlementStable)) {
      setTxErrors([`Invalid stablecoin: ${settlementStable}`]);
      return;
    }

    const assetUpper = newTx.asset.toUpperCase();
    const type = newTx.type as 'Buy'|'Sell'|'Deposit'|'Withdrawal';
    const qty = Number(newTx.quantity);
    // Ensure portfolioId is a number (selectedId can be "all" which is not valid for creating transactions)
    const portfolioId = (typeof selectedId === 'number' ? selectedId : null) ?? 1;

    type TransactionPayload = {
      asset: string;
      type: 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal';
      priceUsd: number | null;
      quantity: number;
      datetime: string;
      notes: string | null;
      portfolioId: number;
      costUsd?: number | null;
      proceedsUsd?: number | null;
    };

    const base: TransactionPayload = {
      asset: assetUpper,
      type,
      priceUsd: (type === 'Buy' || type === 'Sell') ? (newTx.priceUsd ? Number(newTx.priceUsd) : null) : null,
      quantity: qty,
      datetime: newTx.datetime,
      notes: newTx.notes ? newTx.notes : null,
      portfolioId,
      ...calculatedValues,
    };

    const txs: TransactionPayload[] = [base];
    const isStable = isStablecoin(assetUpper);
    const isFiat = isFiatCurrency(assetUpper);
    const stablePx = 1; // stablecoin USD peg; we treat 1 USDT/USDC ~= $1 for auto-generated legs

    // Buy non-stable crypto -> auto Sell stable (spent)
    if (type === 'Buy' && !isStable) {
      const costUsd = calculatedValues?.costUsd;
      if (!costUsd || costUsd <= 0) {
        setTxErrors(['Price USD is required for Buy (used to compute cost and spent stablecoin)']);
        return;
      }
      const stableQty = costUsd / stablePx;
      txs.push({
        asset: settlementStable,
        type: 'Sell',
        priceUsd: stablePx,
        quantity: stableQty,
        datetime: newTx.datetime,
        proceedsUsd: costUsd,
        notes: `[AUTO] Spent ${settlementStable} to buy ${assetUpper}${newTx.notes ? ` | ${newTx.notes}` : ''}`,
        portfolioId,
      });
    }

    // Sell non-stable crypto -> auto Buy stable (received)
    if (type === 'Sell' && !isStable) {
      const proceedsUsd = calculatedValues?.proceedsUsd;
      if (!proceedsUsd || proceedsUsd <= 0) {
        setTxErrors(['Price USD is required for Sell (used to compute proceeds and received stablecoin)']);
        return;
      }
      const stableQty = proceedsUsd / stablePx;
      txs.push({
        asset: settlementStable,
        type: 'Buy',
        priceUsd: stablePx,
        quantity: stableQty,
        datetime: newTx.datetime,
        costUsd: proceedsUsd,
        notes: `[AUTO] Received ${settlementStable} from selling ${assetUpper}${newTx.notes ? ` | ${newTx.notes}` : ''}`,
        portfolioId,
      });
    }

    // Deposit/Withdrawal (fiat) -> auto stable leg
    if ((type === 'Deposit' || type === 'Withdrawal') && isFiat) {
      const amountUsd = convertFiat(qty, assetUpper, 'USD');
      if (type === 'Deposit') {
        txs[0] = { ...txs[0], costUsd: amountUsd };
        const stableQty = amountUsd / stablePx;
        txs.push({
          asset: settlementStable,
          type: 'Buy',
          priceUsd: stablePx,
          quantity: stableQty,
          datetime: newTx.datetime,
          costUsd: amountUsd,
          notes: `[AUTO] Bought ${settlementStable} from deposit ${assetUpper}${newTx.notes ? ` | ${newTx.notes}` : ''}`,
          portfolioId,
        });
      } else {
        txs[0] = { ...txs[0], proceedsUsd: amountUsd };
        const stableQty = amountUsd / stablePx;
        txs.push({
          asset: settlementStable,
          type: 'Sell',
          priceUsd: stablePx,
          quantity: stableQty,
          datetime: newTx.datetime,
          proceedsUsd: amountUsd,
          notes: `[AUTO] Sold ${settlementStable} for withdrawal ${assetUpper}${newTx.notes ? ` | ${newTx.notes}` : ''}`,
          portfolioId,
        });
      }
    }
    
    try {
      const payload = txs.length > 1 ? { portfolioId, transactions: txs } : txs[0];
      const res = await fetch('/api/transactions', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) { 
        setIsOpen(false); 
        setNewTx({ 
          asset:'', 
          type:'Buy', 
          quantity:'', 
          priceUsd:'', 
          datetime:'', 
          notes:'',
          selectedAsset: null,
          settlementStable: 'USDT',
        }); 
        setTxErrors([]);
        if (swrKey) mutate(swrKey);
        // Notify other components that transaction data changed
        window.dispatchEvent(new CustomEvent('transactions-changed')); 
      } else {
        const errorData = await res.json();
        setTxErrors([errorData.error || 'Failed to save transaction']);
      }
    } catch {
      setTxErrors(['Network error. Please try again.']);
    }
  }

  async function removeTx(id: number){
    if (!confirm('Delete this transaction?')) return;
    await fetch(`/api/transactions?id=${id}`, { method:'DELETE' });
    if (swrKey) mutate(swrKey);
    // Notify other components that transaction data changed
    window.dispatchEvent(new CustomEvent('transactions-changed'));
  }

  function startEdit(t: Tx){ setEditing(t); }

  async function saveEdit(e: React.FormEvent){
    e.preventDefault();
    if (!editing) return;
    const body: Partial<Tx> = {
      id: editing.id,
      asset: editing.asset.toUpperCase(),
      type: editing.type,
      priceUsd: editing.priceUsd ?? null,
      quantity: editing.quantity,
      datetime: editing.datetime,
      notes: editing.notes ?? null,
    };
    await fetch('/api/transactions', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    setEditing(null);
    if (swrKey) mutate(swrKey);
    // Notify other components that transaction data changed
    window.dispatchEvent(new CustomEvent('transactions-changed'));
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
                    const fd = new FormData(); fd.append('file', file);
                    await fetch(`/api/transactions/import?portfolioId=${selectedId}`, { method:'POST', body: fd });
                    if (swrKey) mutate(swrKey);
                    // Notify other components that transaction data changed
                    window.dispatchEvent(new CustomEvent('transactions-changed'));
                  }} />
                </label>
                <div className="transaction-template-links">
                  <span>Need a template?</span>
                  <a 
                    href="/transaction-import-default-sample.csv" 
                    download 
                    style={{ textDecoration: 'underline', color: 'var(--primary)' }}
                  >
                    Download default CSV sample
                  </a>
                  <span>·</span>
                  <a 
                    href="/transaction-import-tradingview-sample.csv" 
                    download 
                    style={{ textDecoration: 'underline', color: 'var(--primary)' }}
                  >
                    Download TradingView CSV sample
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <section className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Asset</th><th>Type</th><th>Quantity</th><th>Price USD</th><th>Cost USD</th><th>Proceeds USD</th><th>Notes</th><th></th>
              </tr>
            </thead>
          <tbody>
            {filtered.map(t=> (
              <tr key={t.id}>
                <td>{df.format(new Date(t.datetime))}</td>
                <td>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <CryptoIcon 
                      symbol={t.asset} 
                      size={18}
                      alt={`${t.asset} logo`}
                    />
                    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius: 12, background: `${getAssetColor(t.asset)}22`, color: getAssetColor(t.asset), fontWeight:600 }}>{t.asset.toUpperCase()}</span>
                  </span>
                </td>
                <td>{t.type}</td>
                <td>{nf.format(t.quantity)}</td>
                <td>{t.priceUsd!=null? nf.format(t.priceUsd): ''}</td>
                <td>{t.costUsd!=null? nf.format(t.costUsd): ''}</td>
                <td>{t.proceedsUsd!=null? nf.format(t.proceedsUsd): ''}</td>
                <td>{t.notes||''}</td>
                <td style={{ whiteSpace:'nowrap' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn btn-secondary btn-sm" 
                      onClick={()=>startEdit(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <span style={{ fontSize: '0.8rem' }}>✏️</span>
                      Edit
                    </button>
                    <button 
                      className="btn btn-danger btn-sm" 
                      onClick={()=>removeTx(t.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      <span style={{ fontSize: '0.8rem' }}>🗑️</span>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length===0 && (<tr><td colSpan={9}>No transactions</td></tr>)}
          </tbody>
        </table>
        </div>
      </section>

      {isOpen && (
        <div className="modal-backdrop" onClick={(e)=>{ if (e.target === e.currentTarget) setIsOpen(false); }}>
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
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') ? 'Fiat Currency *' : 'Cryptocurrency *'}
                </label>
                {(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') ? (
                  <select 
                    value={newTx.asset} 
                    onChange={e => {
                      const selectedCurrency = e.target.value;
                      setNewTx(v => ({ 
                        ...v, 
                        asset: selectedCurrency,
                        selectedAsset: null // Clear selected asset for fiat currencies
                      }));
                    }}
                    className="form-select"
                  >
                    <option value="">Select currency</option>
                    {getFiatCurrencies().map(currency => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                ) : (
                  <AssetInput
                    value={newTx.asset}
                    onChange={handleAssetSelection}
                    placeholder="Search for crypto (e.g., Bitcoin, BTC)"
                    disabled={isLoadingPrice}
                  />
                )}
                {isLoadingPrice && (
                  <div className="loading-indicator" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="loading-spinner"></span>
                    Fetching current price...
                  </div>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    Transaction Type *
                  </label>
                  <select 
                    value={newTx.type} 
                    onChange={e=>setNewTx(v=>({ ...v, type:e.target.value }))}
                    className="form-select"
                  >
                    <option value="Buy">Buy</option>
                    <option value="Sell">Sell</option>
                    <option value="Deposit">Deposit</option>
                    <option value="Withdrawal">Withdrawal</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') ? 'Amount *' : 'Quantity *'}
                  </label>
                  <input 
                    type="number" 
                    step="any" 
                    placeholder={(newTx.type === 'Deposit' || newTx.type === 'Withdrawal') ? "0.00" : "0.00"} 
                    value={newTx.quantity} 
                    onChange={e=>setNewTx(v=>({ ...v, quantity:e.target.value }))} 
                    required 
                    className="form-input"
                  />
                </div>
              </div>

              {((newTx.type === 'Buy' || newTx.type === 'Sell') && newTx.selectedAsset && !isStablecoin(newTx.selectedAsset.symbol)) ||
               (newTx.type === 'Deposit' || newTx.type === 'Withdrawal') ? (
                <div className="form-row">
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {newTx.type === 'Buy'
                        ? 'Spend stablecoin *'
                        : newTx.type === 'Sell'
                        ? 'Receive stablecoin *'
                        : (newTx.type === 'Deposit' ? 'Buy stablecoin *' : 'Sell stablecoin *')}
                      <span className="badge badge-info">Auto</span>
                    </label>
                    <select
                      value={newTx.settlementStable}
                      onChange={(e) => setNewTx((v) => ({ ...v, settlementStable: e.target.value }))}
                      className="form-select"
                    >
                      {SUPPORTED_ASSETS.filter(a => a.category === 'stablecoin').map((a) => (
                        <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}

              {(newTx.type === 'Buy' || newTx.type === 'Sell') && (
                <div className="form-row">
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      Price USD {newTx.priceUsd && <span className="badge badge-info">Auto-filled</span>}
                    </label>
                    <input 
                      type="number" 
                      step="any" 
                      placeholder="0.00" 
                      value={newTx.priceUsd} 
                      onChange={e=>setNewTx(v=>({ ...v, priceUsd:e.target.value }))}
                      className="form-input"
                    />
                  </div>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    Date & Time *
                  </label>
                  <input 
                    type="datetime-local" 
                    value={newTx.datetime} 
                    onChange={e=>setNewTx(v=>({ ...v, datetime:e.target.value }))} 
                    required 
                    className="form-input"
                  />
                </div>
              </div>

              {(calculatedValues.costUsd || calculatedValues.proceedsUsd) && (
                <div className="calculated-value" style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  background: newTx.type === 'Buy' ? 'var(--danger-50)' : 'var(--success-50)',
                  color: newTx.type === 'Buy' ? 'var(--danger)' : 'var(--success)',
                  border: `1px solid ${newTx.type === 'Buy' ? 'var(--danger)' : 'var(--success)'}22`,
                }}>
                  <strong>
                    {newTx.type === 'Buy' ? 'Total Cost' : 'Total Proceeds'}: 
                    ${formatPrice(calculatedValues.costUsd || calculatedValues.proceedsUsd || 0)}
                  </strong>
                </div>
              )}

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Notes
                </label>
                <input 
                  placeholder="Optional notes about this transaction" 
                  value={newTx.notes || ''} 
                  onChange={e=>setNewTx(v=>({ ...v, notes:e.target.value }))}
                  className="form-input"
                />
              </div>

              <div className="actions">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={()=>setIsOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={isLoadingPrice}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  {isLoadingPrice ? (
                    <>
                      <span className="loading-spinner"></span>
                      Loading...
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
          <div className="modal" role="dialog" aria-modal="true">
            <div className="card-header">
              <div className="card-title">
                <h3>Edit transaction</h3>
              </div>
              <div className="card-actions">
                <button className="btn btn-secondary btn-sm" onClick={()=>setEditing(null)}>
                  <span style={{ marginRight: 6 }}>✕</span>
                  Close
                </button>
              </div>
            </div>
            <form onSubmit={saveEdit}>
              <input placeholder="Asset" value={editing.asset} onChange={e=>setEditing(v=> v? { ...v, asset:e.target.value } : v)} required />
              <select value={editing.type} onChange={e=>setEditing(v=> v? { ...v, type:e.target.value as 'Buy'|'Sell'|'Deposit'|'Withdrawal' } : v)}>
                <option>Buy</option>
                <option>Sell</option>
                <option>Deposit</option>
                <option>Withdrawal</option>
              </select>
              <input type="number" step="any" placeholder="Quantity" value={editing.quantity} onChange={e=>setEditing(v=> v? { ...v, quantity:Number(e.target.value) } : v)} required />
              <input type="number" step="any" placeholder="Price USD (optional)" value={editing.priceUsd ?? ''} onChange={e=>setEditing(v=> v? { ...v, priceUsd:e.target.value === ''? null : Number(e.target.value) } : v)} />
              <input type="datetime-local" value={editing.datetime && !isNaN(new Date(editing.datetime).getTime()) ? new Date(editing.datetime).toISOString().slice(0,16) : ''} onChange={e=>setEditing(v=> v? { ...v, datetime:e.target.value } : v)} required />
              <input placeholder="Notes (optional)" value={editing.notes ?? ''} onChange={e=>setEditing(v=> v? { ...v, notes:e.target.value } : v)} />
              <div className="actions">
                <button type="button" className="btn btn-secondary" onClick={()=>setEditing(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
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

      .transaction-export-form select {
        padding: 0.5rem;
        border-radius: 4px;
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text);
      }

      .transaction-import-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        align-items: flex-start;
      }

      .transaction-template-links {
        font-size: 0.8rem;
        color: var(--muted);
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        align-items: center;
      }

      .transaction-template-links a {
        text-decoration: underline;
        color: var(--primary);
      }

      .transaction-modal {
        max-width: 600px;
        width: 100%;
      }

      .transaction-form {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .form-group label {
        font-weight: 600;
        color: var(--text);
        font-size: 14px;
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

      .loading-indicator {
        font-size: 12px;
        color: var(--muted);
        font-style: italic;
        margin-top: 4px;
      }

      .calculated-value {
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 12px;
        text-align: center;
        color: var(--primary);
        font-size: 16px;
      }

      @media (max-width: 768px) {
        .transaction-toolbar-actions {
          flex-direction: column;
          align-items: stretch;
        }

        .transaction-toolbar-actions > * {
          width: 100%;
        }

        .transaction-export-form {
          justify-content: space-between;
        }

        .transaction-export-form select {
          flex: 1;
        }

        .transaction-export-form button {
          width: auto;
          white-space: nowrap;
        }

        .transaction-import-wrapper {
          align-items: stretch;
        }

        .transaction-import-wrapper .btn {
          width: 100%;
          justify-content: center;
        }

        .transaction-template-links {
          justify-content: center;
          text-align: center;
        }

        .transaction-modal {
          margin: 16px;
          max-height: 90vh;
          overflow-y: auto;
        }

        .form-row {
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .transaction-form {
          gap: 16px;
        }

        .form-input, .form-select {
          padding: 12px;
          font-size: 16px; /* Prevent zoom on iOS */
        }
      }

      @media (max-width: 480px) {
        .transaction-modal {
          margin: 8px;
          padding: 16px;
        }

        .form-group label {
          font-size: 13px;
        }

        .calculated-value {
          font-size: 14px;
          padding: 10px;
        }
      }
    `}</style>
    </main>
    </AuthGuard>
  );
}
