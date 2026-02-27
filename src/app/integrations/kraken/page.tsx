'use client';

import { useState, useRef, useEffect } from 'react';
import AuthGuard from '@/components/AuthGuard';
import { usePortfolio } from '../../PortfolioProvider';
import { useExchangeConnection } from '@/hooks/useExchangeConnection';
import type { NormalizedTrade } from '@/lib/integrations/crypto-com';

type Step = 'credentials' | 'preview' | 'importing' | 'done';
type ImportMode = 'api' | 'csv';

export default function KrakenIntegrationPage() {
  const { portfolios } = usePortfolio();
  const conn = useExchangeConnection('kraken');
  const [mode, setMode] = useState<ImportMode>('csv');
  const [step, setStep] = useState<Step>('credentials');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');

  useEffect(() => {
    if (conn.isLoaded && conn.savedKey) {
      setApiKey(conn.savedKey);
      setApiSecret(conn.savedSecret);
      setMode('api');
    }
  }, [conn.isLoaded, conn.savedKey, conn.savedSecret]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trades, setTrades] = useState<NormalizedTrade[]>([]);
  const [selectedTrades, setSelectedTrades] = useState<Set<string>>(new Set());
  const [portfolioId, setPortfolioId] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [skippedKinds, setSkippedKinds] = useState<Record<string, number>>({});
  const [unsupportedAssets, setUnsupportedAssets] = useState<string[]>([]);

  async function handleFetchTrades(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/integrations/kraken/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          apiSecret,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch trades');

      await conn.save(apiKey, apiSecret);

      setTrades(data.trades);
      setSelectedTrades(new Set(data.trades.map((t: NormalizedTrade) => t.externalId)));
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCsvUpload(file: File) {
    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/integrations/kraken/csv-parse', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to parse CSV');

      setTrades(data.trades);
      setSelectedTrades(new Set(data.trades.map((t: NormalizedTrade) => t.externalId)));
      setCsvWarnings(data.warnings || []);
      setSkippedKinds(data.skippedKinds || {});
      setUnsupportedAssets(data.unsupportedAssets || []);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!portfolioId || selectedTrades.size === 0) return;
    setStep('importing');
    setError('');

    try {
      const selected = trades.filter(t => selectedTrades.has(t.externalId));
      const res = await fetch('/api/integrations/kraken/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trades: selected,
          portfolioId,
          importSource: mode === 'csv' ? 'kraken-csv' : 'kraken-api',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      setImportResult(data);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview');
    }
  }

  function toggleTrade(id: string) {
    setSelectedTrades(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedTrades.size === trades.length) {
      setSelectedTrades(new Set());
    } else {
      setSelectedTrades(new Set(trades.map(t => t.externalId)));
    }
  }

  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 });
  const df = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <AuthGuard redirectTo="/integrations/crypto-com">
      <main style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg, #5741D9, #7B61FF)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 700, fontSize: '1rem',
          }}>K</div>
          <h1 style={{ margin: 0 }}>Kraken</h1>
        </div>
        <p style={{ color: 'var(--muted)', marginBottom: '1.5rem' }}>
          Import your trade history from Kraken or Exchange
        </p>

        {/* Mode selector */}
        {step === 'credentials' && (
          <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', width: 'fit-content' }}>
            <button
              onClick={() => setMode('csv')}
              style={{
                padding: '0.6rem 1.25rem', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                background: mode === 'csv' ? 'var(--primary)' : 'var(--surface)',
                color: mode === 'csv' ? '#fff' : 'var(--muted)',
              }}
            >
              App (CSV Upload)
            </button>
            <button
              onClick={() => setMode('api')}
              style={{
                padding: '0.6rem 1.25rem', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                background: mode === 'api' ? 'var(--primary)' : 'var(--surface)',
                color: mode === 'api' ? '#fff' : 'var(--muted)',
              }}
            >
              Exchange (API)
            </button>
          </div>
        )}

        {error && (
          <div style={{
            background: 'var(--danger-50)',
            border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)',
            color: 'var(--danger)',
            borderRadius: 8, padding: '12px 16px', marginBottom: '1.5rem', fontSize: '0.9rem',
          }}>
            {error}
          </div>
        )}

        {/* Step 1a: CSV Upload (App) */}
        {step === 'credentials' && mode === 'csv' && (
          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Upload Kraken CSV</h2>
            </div>
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{
                background: 'var(--primary-50)', border: '1px solid color-mix(in oklab, var(--primary) 20%, transparent)',
                borderRadius: 8, padding: '12px 16px', fontSize: '0.85rem',
              }}>
                <strong>How to export from Kraken:</strong>
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.8 }}>
                  <li>Go to <a href="https://www.kraken.com/u/history/ledger" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Kraken → History → Ledger</a></li>
                  <li>Select <strong>Ledgers</strong> as the export type</li>
                  <li>Choose your date range</li>
                  <li>Click <strong>Export</strong> to download the CSV</li>
                  <li>Upload the downloaded file below</li>
                </ol>
              </div>

              <div
                style={{
                  border: '2px dashed var(--border)', borderRadius: 12,
                  padding: '3rem 2rem', textAlign: 'center', cursor: 'pointer',
                  transition: 'border-color 0.2s',
                }}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary)'; }}
                onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = 'var(--border)';
                  const file = e.dataTransfer.files[0];
                  if (file) handleCsvUpload(file);
                }}
              >
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📄</div>
                <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
                  {loading ? 'Parsing...' : 'Drop your CSV file here or click to browse'}
                </p>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.85rem' }}>
                  Supports ledger export CSV from the Kraken
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleCsvUpload(file);
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <a href="/settings" className="btn btn-secondary" style={{ textDecoration: 'none' }}>Cancel</a>
              </div>
            </div>
          </div>
        )}

        {/* Step 1b: API Credentials (Exchange) */}
        {step === 'credentials' && mode === 'api' && (
          <div className="card">
            <div className="card-header">
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Connect Your Account</h2>
            </div>
            <form onSubmit={handleFetchTrades} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {conn.hasSaved ? (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--success-50)', border: '1px solid color-mix(in oklab, var(--success) 30%, transparent)',
                  borderRadius: 8, padding: '10px 14px',
                }}>
                  <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.9rem' }}>
                    &#10003; Connected — API keys saved securely
                  </span>
                  <button type="button" className="btn btn-sm" onClick={async () => { await conn.remove(); setApiKey(''); setApiSecret(''); }}
                    style={{ color: 'var(--muted)', background: 'none', border: '1px solid var(--border)', fontSize: '0.8rem' }}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <p style={{ color: 'var(--muted)', fontSize: '0.9rem', margin: 0 }}>
                  Enter your Kraken API credentials. Use a <strong>read-only</strong> API key for security.
                  Your keys will be saved encrypted for future use.
                </p>
              )}

              <div style={{
                background: 'var(--primary-50)', border: '1px solid color-mix(in oklab, var(--primary) 20%, transparent)',
                borderRadius: 8, padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text)',
              }}>
                <strong>How to get your API key:</strong>
                <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.8 }}>
                  <li>Go to <a href="https://www.kraken.com/u/security/api" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Kraken → Settings → API</a></li>
                  <li>Click &quot;Generate New Key&quot;</li>
                  <li>Enable only <strong>Query Ledger Entries</strong> &amp; <strong>Query Funds</strong></li>
                  <li>Copy the API Key and Private Key</li>
                </ol>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>API Key</label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="Your Kraken API key"
                  required
                  style={{ width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>Secret Key</label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={e => setApiSecret(e.target.value)}
                  placeholder="Your Kraken Private key"
                  required
                  style={{ width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>Start Date (optional)</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>End Date (optional)</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    style={{ width: '100%', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <a href="/settings" className="btn btn-secondary" style={{ textDecoration: 'none' }}>Cancel</a>
                <button type="submit" className="btn btn-primary" disabled={loading || !apiKey || !apiSecret}>
                  {loading ? 'Connecting...' : 'Fetch Trades'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Step 2: Preview trades */}
        {step === 'preview' && (
          <div>
            {/* Warnings & info banners */}
            {unsupportedAssets.length > 0 && (
              <div style={{
                background: 'var(--warning-50)', border: '1px solid color-mix(in oklab, var(--warning) 30%, transparent)',
                borderRadius: 8, padding: '12px 16px', marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text)',
              }}>
                <strong style={{ color: 'var(--warning)' }}>Unknown assets detected:</strong>{' '}
                {unsupportedAssets.join(', ')} — prices may not be available. Transactions will still be imported.
              </div>
            )}
            {Object.keys(skippedKinds).length > 0 && (
              <div style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '12px 16px', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--muted)',
              }}>
                <strong>Skipped transactions:</strong>{' '}
                {Object.entries(skippedKinds).map(([kind, count]) => `${kind} (${count})`).join(', ')}
              </div>
            )}
            {csvWarnings.map((w, i) => (
              <div key={i} style={{
                background: 'var(--warning-50)', border: '1px solid color-mix(in oklab, var(--warning) 30%, transparent)',
                borderRadius: 8, padding: '10px 14px', marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--text)',
              }}>
                {w}
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '1.1rem' }}>{trades.length} trades found</span>
                <span style={{ color: 'var(--muted)', marginLeft: '0.5rem' }}>
                  ({selectedTrades.size} selected)
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={portfolioId ?? ''}
                  onChange={e => setPortfolioId(e.target.value ? Number(e.target.value) : null)}
                  style={{ padding: '0.5rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  <option value="">Select portfolio...</option>
                  {portfolios.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button className="btn btn-secondary btn-sm" onClick={() => setStep('credentials')}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!portfolioId || selectedTrades.size === 0}
                >
                  Import {selectedTrades.size} Trades
                </button>
              </div>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--background)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left' }}>
                        <input type="checkbox" checked={selectedTrades.size === trades.length} onChange={toggleAll} />
                      </th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Type</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>From</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>To</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Price</th>
                      <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--muted)', fontSize: '0.75rem', textTransform: 'uppercase' }}>Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(trade => {
                      const isBuy = trade.notes?.includes('→') && trade.fromAsset && ['USD', 'EUR', 'GBP', 'USDC', 'USDT', 'USDG'].includes(trade.fromAsset);
                      return (
                        <tr key={trade.externalId} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.75rem' }}>
                            <input type="checkbox" checked={selectedTrades.has(trade.externalId)} onChange={() => toggleTrade(trade.externalId)} />
                          </td>
                          <td style={{ padding: '0.75rem', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                            {df.format(new Date(trade.datetime))}
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            {(() => {
                              const isDeposit = !trade.fromAsset && trade.toAsset;
                              const isWithdraw = trade.fromAsset && !trade.toAsset;
                              if (isDeposit) return <span className="transaction-type-badge deposit">Deposit</span>;
                              if (isWithdraw) return <span className="transaction-type-badge withdrawal">Withdraw</span>;
                              return <span className={`transaction-type-badge ${isBuy ? 'buy' : 'sell'}`}>{isBuy ? 'Buy' : 'Sell'}</span>;
                            })()}
                          </td>
                          <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                            {trade.fromAsset ? `${nf.format(trade.fromQuantity)} ${trade.fromAsset}` : '—'}
                          </td>
                          <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                            {trade.toAsset ? `${nf.format(trade.toQuantity)} ${trade.toAsset}` : '—'}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {trade.toPriceUsd != null ? `$${nf.format(trade.toPriceUsd)}` : '—'}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--muted)' }}>
                            {trade.feesUsd != null && trade.feesUsd > 0 ? `$${nf.format(trade.feesUsd)}` : (trade.feeCurrency && trade.notes?.includes('fee:') ? trade.notes.match(/fee: ([\d.]+)/)?.[1] + ' ' + trade.feeCurrency : '—')}
                          </td>
                        </tr>
                      );
                    })}
                    {trades.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                          No trades found for the selected date range
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Importing */}
        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <div className="loading-spinner" style={{ width: 40, height: 40, margin: '0 auto 1.5rem' }} />
            <h2 style={{ margin: '0 0 0.5rem' }}>Importing trades...</h2>
            <p style={{ color: 'var(--muted)' }}>Creating {selectedTrades.size} transactions in your portfolio</p>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && importResult && (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>&#10003;</div>
            <h2 style={{ margin: '0 0 0.5rem' }}>Import Complete</h2>
            <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>
              Successfully imported <strong>{importResult.imported} trades</strong> from Kraken
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <a href="/transactions" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                View Transactions
              </a>
              <button className="btn btn-secondary" onClick={() => { setStep('credentials'); setTrades([]); }}>
                Import More
              </button>
            </div>
          </div>
        )}
      </main>
    </AuthGuard>
  );
}
