'use client';
import useSWR from 'swr';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, getFiatCurrencies, convertFiat } from '@/lib/assets';
import AuthGuard from '@/components/AuthGuard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { ChartCard } from '@/components/ChartCard';
import { startIsoForTimeframe } from '@/lib/timeframe';
import { SankeyExplorer } from './components/SankeyExplorer';

import type { Layout, Data } from 'plotly.js';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';
import type { RomaniaTaxReport } from '@/lib/tax/romania-v2';

const fetcher = jsonFetcher;

export default function CashDashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [selectedTaxYear, setSelectedTaxYear] = useState<string>('all');
  const [selectedAssetLotStrategy, setSelectedAssetLotStrategy] = useState<'FIFO' | 'LIFO' | 'HIFO' | 'LOFO'>('FIFO');
  const [selectedCashLotStrategy, setSelectedCashLotStrategy] = useState<'FIFO' | 'LIFO' | 'HIFO' | 'LOFO'>('FIFO');
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);
  const exportGuardsRef = useRef<Set<string>>(new Set());

  // Fetch Romania tax report for selected year
  const taxReportKey = selectedTaxYear !== 'all'
    ? `/api/tax/romania?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`
    : null;
  const { data: taxReport, isLoading: loadingTax, error: taxError } = useSWR<RomaniaTaxReport>(taxReportKey, fetcher);

  const fiatCurrencies = getFiatCurrencies();

  // Filter for fiat currency transactions only
  const fiatTxs = useMemo(() => {
    const fc = getFiatCurrencies();
    return (txs || []).filter(tx => {
      const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
      if (!isCashTransaction) return false;

      const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      const isFiat = fc.includes(fiatAsset);

      if (!isFiat) return false;

      if (selectedTaxYear !== 'all') {
        const txYear = new Date(tx.datetime).getFullYear().toString();
        return txYear === selectedTaxYear;
      }

      return true;
    });
  }, [txs, selectedTaxYear]);

  // Get available tax years from all fiat transactions
  const availableTaxYears = useMemo(() => {
    const fc = getFiatCurrencies();
    const allFiatTxs = (txs || []).filter(tx => {
      const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
      if (!isCashTransaction) return false;
      const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      return fc.includes(fiatAsset);
    });

    const years = new Set<string>();
    allFiatTxs.forEach(tx => {
      const year = new Date(tx.datetime).getFullYear().toString();
      years.add(year);
    });

    return ['all', ...Array.from(years).sort((a, b) => b.localeCompare(a))];
  }, [txs]);

  // Default Tax Year: last full calendar year
  useEffect(() => {
    if (selectedTaxYear !== 'all') return;
    const yearsOnly = availableTaxYears.filter((y) => y !== 'all');
    if (!yearsOnly.length) return;

    const lastFullYear = new Date().getFullYear() - 1;
    const best = yearsOnly
      .map((y) => parseInt(y, 10))
      .filter((y) => Number.isFinite(y) && y <= lastFullYear)
      .sort((a, b) => b - a)[0];

    if (best !== undefined) setSelectedTaxYear(String(best));
  }, [availableTaxYears, selectedTaxYear]);

  const triggerDownloadOnce = useCallback((key: string, url: string) => {
    if (exportGuardsRef.current.has(key)) return;
    exportGuardsRef.current.add(key);
    setTimeout(() => exportGuardsRef.current.delete(key), 1500);

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // Calculate cash flow data
  const cashFlowData = useMemo(() => {
    const data: { [key: string]: { deposits: number; withdrawals: number; balance: number; dates: string[] } } = {};
    fiatCurrencies.forEach(currency => {
      data[currency] = { deposits: 0, withdrawals: 0, balance: 0, dates: [] };
    });

    const sortedTxs = [...fiatTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    sortedTxs.forEach(tx => {
      const currency = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      const amount = tx.type === 'Deposit'
        ? (tx.fromQuantity || 0)
        : (tx.toQuantity || 0);
      const date = new Date(tx.datetime).toISOString().split('T')[0];

      if (!data[currency]) {
        data[currency] = { deposits: 0, withdrawals: 0, balance: 0, dates: [] };
      }

      if (tx.type === 'Deposit') {
        data[currency].deposits += amount;
        data[currency].balance += amount;
      } else if (tx.type === 'Withdrawal') {
        data[currency].withdrawals += amount;
        data[currency].balance -= amount;
      }

      if (!data[currency].dates.includes(date)) {
        data[currency].dates.push(date);
      }
    });

    return data;
  }, [fiatTxs, fiatCurrencies]);

  // Calculate running balance over time (all fiat currencies converted to USD)
  const balanceOverTime = useMemo(() => {
    const startingBalancesByCurrency: Record<string, number> = {};
    if (selectedTaxYear !== 'all') {
      const allFiatTxs = (txs || []).filter(tx => {
        const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
        if (!isCashTransaction) return false;
        const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
          ? tx.fromAsset.toUpperCase()
          : tx.toAsset.toUpperCase();
        const isFiat = fiatCurrencies.includes(fiatAsset);
        if (!isFiat) return false;
        const txYear = new Date(tx.datetime).getFullYear().toString();
        return txYear < selectedTaxYear;
      });

      fiatCurrencies.forEach(currency => {
        startingBalancesByCurrency[currency] = 0;
      });

      allFiatTxs.forEach(tx => {
        const currency = tx.type === 'Deposit' && tx.fromAsset
          ? tx.fromAsset.toUpperCase()
          : tx.toAsset.toUpperCase();
        const amount = tx.type === 'Deposit'
          ? (tx.fromQuantity || 0)
          : (tx.toQuantity || 0);

        if (tx.type === 'Deposit') {
          startingBalancesByCurrency[currency] = (startingBalancesByCurrency[currency] || 0) + amount;
        } else if (tx.type === 'Withdrawal') {
          startingBalancesByCurrency[currency] = (startingBalancesByCurrency[currency] || 0) - amount;
        }
      });
    }

    const sortedTxs = [...fiatTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    const dates: string[] = [];
    const balances: number[] = [];
    const balancesByCurrency: Record<string, number> = { ...startingBalancesByCurrency };

    fiatCurrencies.forEach(currency => {
      if (balancesByCurrency[currency] === undefined) {
        balancesByCurrency[currency] = 0;
      }
    });

    if (selectedTaxYear !== 'all' && sortedTxs.length > 0) {
      const firstTxDate = new Date(sortedTxs[0].datetime);
      const yearStart = new Date(parseInt(selectedTaxYear), 0, 1);
      if (firstTxDate > yearStart) {
        let startingBalanceUsd = 0;
        for (const [curr, balance] of Object.entries(balancesByCurrency)) {
          if (balance !== 0) {
            startingBalanceUsd += convertFiat(balance, curr, 'USD');
          }
        }
        dates.push(yearStart.toISOString().split('T')[0]);
        balances.push(startingBalanceUsd);
      }
    }

    sortedTxs.forEach(tx => {
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      const currency = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      const amount = tx.type === 'Deposit'
        ? (tx.fromQuantity || 0)
        : (tx.toQuantity || 0);

      if (tx.type === 'Deposit') {
        balancesByCurrency[currency] = (balancesByCurrency[currency] || 0) + amount;
      } else if (tx.type === 'Withdrawal') {
        balancesByCurrency[currency] = (balancesByCurrency[currency] || 0) - amount;
      }

      let totalBalanceUsd = 0;
      for (const [curr, balance] of Object.entries(balancesByCurrency)) {
        if (balance !== 0) {
          totalBalanceUsd += convertFiat(balance, curr, 'USD');
        }
      }

      dates.push(date);
      balances.push(totalBalanceUsd);
    });

    return { dates, balances };
  }, [fiatTxs, fiatCurrencies, selectedTaxYear, txs]);

  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  // Chart layouts
  const cashFlowLayout: Partial<Layout> = {
    title: { text: `Cash Flow by Currency${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Currency' } },
    yaxis: { title: { text: 'Amount' } },
    barmode: 'group',
    height: 400,
  };

  const balanceOverTimeLayout: Partial<Layout> = {
    title: { text: `Total Cash Balance Over Time (USD)${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Date' } },
    yaxis: { title: { text: 'Balance (USD)' } },
    height: 400,
  };

  const monthlyCashFlowLayout: Partial<Layout> = {
    title: { text: `Monthly Cash Flow - ${selectedCurrency}${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Month' } },
    yaxis: { title: { text: `${selectedCurrency} Amount` } },
    barmode: 'group',
    height: 400,
  };

  const totalBalancesLayout: Partial<Layout> = {
    title: { text: `Total Balances (USD Equivalent)${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    height: 400,
  };

  if (loadingTxs) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>Cash Dashboard</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <AuthGuard redirectTo="/cash-dashboard">
      <main className="dashboard-container">
      <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', fontSize: '2rem', fontWeight: 800 }}>
          💰 Cash Dashboard
        </h1>
        <p className="subtitle" style={{ fontSize: '1rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
          Track your fiat currency deposits, withdrawals, and cash flow over time (EUR & USD only)
        </p>
      </div>

        {/* Filters */}
        <div className="toolbar" style={{ marginBottom: '2rem' }}>
          <div className="filters">
            <label>
              Currency
              <select value={selectedCurrency} onChange={(e) => setSelectedCurrency(e.target.value)}>
                {fiatCurrencies.map(currency => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>

            <label>
              Tax Year
              <select value={selectedTaxYear} onChange={(e) => setSelectedTaxYear(e.target.value)}>
                {availableTaxYears.map(year => (
                  <option key={year} value={year}>
                    {year === 'all' ? 'All Years' : year}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Asset Lot Strategy
              <select
                value={selectedAssetLotStrategy}
                onChange={(e) => setSelectedAssetLotStrategy(e.target.value as 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO')}
                title="Applied when selling crypto assets (affects realized gains on sells). Romania may require FIFO; use alternatives for scenario analysis."
              >
                <option value="FIFO">FIFO</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO (min gains)</option>
                <option value="LOFO">LOFO (max gains)</option>
              </select>
            </label>

            <label>
              Cash Lot Strategy
              <select
                value={selectedCashLotStrategy}
                onChange={(e) => setSelectedCashLotStrategy(e.target.value as 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO')}
                title="Applied when consuming cash lots (buys + withdrawals). Use FIFO for clean chronological withdrawal traceability; try LIFO/HIFO/LOFO for scenario analysis."
              >
                <option value="FIFO">FIFO (clean trace)</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO</option>
                <option value="LOFO">LOFO</option>
              </select>
            </label>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="dashboard-summary">
          {fiatCurrencies.map(currency => {
            const data = cashFlowData[currency];
            const totalDeposits = data.deposits;
            const totalWithdrawals = data.withdrawals;
            const netFlow = totalDeposits - totalWithdrawals;

            return (
              <div key={currency} className="summary-card">
                <div className="summary-label" style={{ color: colorFor(currency), fontWeight: 600 }}>
                  {currency}
                </div>
                <div className="summary-value">
                  {netFlow >= 0 ? '+' : ''}{netFlow.toFixed(2)} {currency}
                </div>
                <div className="summary-subtext">
                  Deposits: {totalDeposits.toFixed(2)} | Withdrawals: {totalWithdrawals.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>

      {/* Charts Grid */}
      <div className="dashboard-grid">
        <ChartCard title="Cash Flow by Currency" infoText="Fiat deposits vs withdrawals grouped by currency.">
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const filtered = startIso ? fiatTxs.filter((t) => new Date(t.datetime).toISOString().slice(0, 10) >= startIso) : fiatTxs;

            const fc = getFiatCurrencies();
            const cashFlowDataLocal: { [key: string]: { deposits: number; withdrawals: number } } = {};
            fc.forEach((c) => (cashFlowDataLocal[c] = { deposits: 0, withdrawals: 0 }));
            for (const tx of filtered) {
              const cur = tx.type === 'Deposit' && tx.fromAsset
                ? tx.fromAsset.toUpperCase()
                : tx.toAsset.toUpperCase();
              if (!cashFlowDataLocal[cur]) continue;
              const amount = tx.type === 'Deposit'
                ? (tx.fromQuantity || 0)
                : (tx.toQuantity || 0);
              if (tx.type === 'Deposit') cashFlowDataLocal[cur].deposits += amount;
              else if (tx.type === 'Withdrawal') cashFlowDataLocal[cur].withdrawals += amount;
            }

            const chart: Data[] = [
              { x: fc, y: fc.map((c) => cashFlowDataLocal[c].deposits), type: 'bar', name: 'Deposits', marker: { color: '#10b981' } },
              { x: fc, y: fc.map((c) => cashFlowDataLocal[c].withdrawals), type: 'bar', name: 'Withdrawals', marker: { color: '#ef4444' } },
            ];

            return <Plot data={chart} layout={{ ...cashFlowLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>

        <ChartCard title="Total Cash Balance Over Time (USD)" infoText="Running fiat cash balance over time, converted to USD.">
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const idx = startIso ? (() => {
              const dates = balanceOverTime.dates;
              for (let i = 0; i < dates.length; i++) if (dates[i] >= startIso) return i;
              return dates.length;
            })() : 0;
            const dates = balanceOverTime.dates.slice(idx);
            const bals = balanceOverTime.balances.slice(idx);
            const chart: Data[] = [{ x: dates, y: bals, type: 'scatter', mode: 'lines+markers', name: 'Total Cash Balance (USD)', line: { color: '#3b82f6' }, marker: { size: 6 } }];
            return <Plot data={chart} layout={{ ...balanceOverTimeLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>

        <ChartCard title={`Monthly Cash Flow - ${selectedCurrency}`} infoText={selectedCurrency === 'USD'
          ? "Monthly deposits vs withdrawals converted to USD (includes all currencies)."
          : `Monthly deposits vs withdrawals for ${selectedCurrency}.`}>
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const filteredTxs = fiatTxs.filter((tx) => (startIso ? new Date(tx.datetime).toISOString().slice(0, 10) >= startIso : true));

            const monthlyData: { [key: string]: { deposits: number; withdrawals: number } } = {};
            for (const tx of filteredTxs) {
              const date = new Date(tx.datetime);
              const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              if (!monthlyData[monthKey]) monthlyData[monthKey] = { deposits: 0, withdrawals: 0 };

              const txCurrency = tx.type === 'Deposit' && tx.fromAsset
                ? tx.fromAsset.toUpperCase()
                : tx.toAsset.toUpperCase();
              const txAmount = tx.type === 'Deposit'
                ? (tx.fromQuantity || 0)
                : (tx.toQuantity || 0);

              let amount = txAmount;
              if (txCurrency !== selectedCurrency) {
                if (tx.type === 'Deposit' && tx.fromPriceUsd) {
                  amount = selectedCurrency === 'USD'
                    ? txAmount * tx.fromPriceUsd
                    : convertFiat(txAmount, txCurrency, selectedCurrency);
                } else if (tx.type === 'Withdrawal' && tx.toPriceUsd) {
                  amount = selectedCurrency === 'USD'
                    ? txAmount * tx.toPriceUsd
                    : convertFiat(txAmount, txCurrency, selectedCurrency);
                } else {
                  amount = convertFiat(txAmount, txCurrency, selectedCurrency);
                }
              }

              if (tx.type === 'Deposit') monthlyData[monthKey].deposits += amount;
              else if (tx.type === 'Withdrawal') monthlyData[monthKey].withdrawals += amount;
            }
            const months = Object.keys(monthlyData).sort();
            const deposits = months.map((m) => monthlyData[m].deposits);
            const withdrawals = months.map((m) => monthlyData[m].withdrawals);

            const chart: Data[] = [
              { x: months, y: deposits, type: 'bar', name: 'Deposits', marker: { color: '#10b981' } },
              { x: months, y: withdrawals, type: 'bar', name: 'Withdrawals', marker: { color: '#ef4444' } },
            ];

            return <Plot data={chart} layout={{ ...monthlyCashFlowLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>

        <ChartCard title="Total Balances (USD Equivalent)" infoText="Pie chart of USD-equivalent balances by fiat currency.">
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const filtered = startIso ? fiatTxs.filter((t) => new Date(t.datetime).toISOString().slice(0, 10) >= startIso) : fiatTxs;
            const fc = getFiatCurrencies();
            const totals: { [key: string]: number } = {};
            for (const c of fc) totals[c] = 0;
            for (const tx of filtered) {
              const c = tx.toAsset.toUpperCase();
              if (!(c in totals)) continue;
              if (tx.type === 'Deposit') totals[c] += tx.toQuantity;
              else if (tx.type === 'Withdrawal') totals[c] -= tx.toQuantity;
            }
            const currenciesWithBalances = fc.filter((c) => Math.abs(convertFiat(totals[c], c, 'USD')) > 0.01);
            if (!currenciesWithBalances.length) {
              return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No cash balances to display</div>;
            }
            const pie: Data[] = [
              {
                labels: currenciesWithBalances,
                values: currenciesWithBalances.map((c) => Math.abs(convertFiat(totals[c], c, 'USD'))),
                type: 'pie',
                marker: { colors: currenciesWithBalances.map((c) => getAssetColor(c)) },
                textinfo: 'label+percent',
              } as unknown as Data,
            ];
            return <Plot data={pie} layout={{ ...totalBalancesLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>
      </div>

      {/* Romanian Tax Report Section */}
      {selectedTaxYear !== 'all' && (
        <div style={{ marginTop: '2rem' }}>
          <h2>
            🇷🇴 Romanian Tax Report ({selectedTaxYear}) — Asset: {selectedAssetLotStrategy}, Cash: {selectedCashLotStrategy}
          </h2>
          {(selectedAssetLotStrategy !== 'FIFO' || selectedCashLotStrategy !== 'FIFO') && (
            <div style={{
              marginTop: '0.75rem',
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              color: 'var(--text)',
              fontSize: '0.9rem',
            }}>
              <strong>Note:</strong> Romania may require <strong>FIFO</strong> for tax reporting. Other strategies are provided for
              scenario analysis (e.g., exploring tax-minimizing lot selection like HIFO).
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Taxable events are withdrawals from crypto to fiat. All calculations use FIFO (First In First Out) method.
            Calculations done in USD (USDC), with EUR values converted using historical FX per withdrawal date.
            <br />
            <strong>Note:</strong> Cost basis represents your original purchase price, not the sale price.
            If cost basis &gt; withdrawals, it means you sold assets at a loss (which is correct for tax reporting).
            Cost basis only includes assets that were actually withdrawn, not unsold holdings.
          </p>

          {loadingTax ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading tax report...
            </div>
          ) : taxError ? (
            <div style={{
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'rgba(239, 68, 68, 0.10)',
              color: 'var(--text)',
              marginBottom: '1rem'
            }}>
              <strong>Tax report failed to load.</strong>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                {(taxError as Error)?.message || 'Unknown error'}
              </div>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                This usually means historical FX rates could not be fetched. Please retry, or check server logs for the exact provider error.
              </div>
            </div>
          ) : taxReport && Array.isArray(taxReport.taxableEvents) && taxReport.taxableEvents.length > 0 ? (
            <>
              {/* Tax Summary Cards */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '2rem'
              }}>
                <div className="summary-card">
                  <div className="summary-label">Total Withdrawals</div>
                  <div className="summary-value">${taxReport.totalWithdrawalsUsd.toFixed(2)}</div>
                  <div className="summary-subtext">USD</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Total Cost Basis</div>
                  <div className="summary-value">${taxReport.totalCostBasisUsd.toFixed(2)}</div>
                  <div className="summary-subtext">USD</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Total Gain/Loss</div>
                  <div className={`summary-value ${taxReport.totalGainLossUsd >= 0 ? 'positive' : 'negative'}`}>
                    ${taxReport.totalGainLossUsd >= 0 ? '+' : ''}{taxReport.totalGainLossUsd.toFixed(2)}
                  </div>
                  <div className={`summary-subtext ${taxReport.totalGainLossUsd >= 0 ? 'positive' : 'negative'}`}>USD</div>
                </div>
              </div>

              {/* Diagnostic Information */}
              {taxReport.remainingCashUsd !== undefined && taxReport.remainingCashUsd > 0 && (
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'var(--surface)',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-secondary)'
                }}>
                  <strong>Note:</strong> You have {taxReport.remainingCashUsd.toFixed(2)} USD remaining in cash balance
                  (cost basis: ${taxReport.remainingCashCostBasisUsd?.toFixed(2) || '0.00'}) that hasn&apos;t been withdrawn yet.
                  This is <strong>not included</strong> in the tax report above - only withdrawn amounts are taxable.
                </div>
              )}

              {/* Taxable Events Table */}
              <section className="card" style={{ marginBottom: '2rem' }}>
                <div className="card-header">
                  <div className="card-title">
                    <h3 style={{ margin: 0 }}>Taxable Events (Withdrawals to Fiat)</h3>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        try {
                          e.preventDefault();
                          e.stopPropagation();
                          const url = `/api/tax/romania/export?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`;
                          triggerDownloadOnce(`tax-export-full-${selectedTaxYear}-${selectedId || 'none'}`, url);
                        } catch (error) {
                          console.error('Export failed:', error);
                        }
                      }}
                      className="btn btn-primary btn-sm"
                    >
                      📥 Export Full Report
                    </button>
                  </div>
                </div>
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Amount (USD)</th>
                        <th style={{ textAlign: 'right' }}>Amount (Original)</th>
                        <th style={{ textAlign: 'right' }}>Cost Basis (USD)</th>
                        <th style={{ textAlign: 'right' }}>Gain/Loss (USD)</th>
                        <th style={{ textAlign: 'right' }}>Gain/Loss (Original)</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxReport.taxableEvents
                        .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
                        .map((event) => (
                          <React.Fragment key={event.transactionId}>
                            <tr>
                              <td>{new Date(event.datetime).toLocaleDateString()}</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>${event.fiatAmountUsd.toFixed(2)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                {event.fiatCurrency !== 'USD' ? event.fiatAmountOriginal.toFixed(2) + ' ' + event.fiatCurrency : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>${event.costBasisUsd.toFixed(2)}</td>
                              <td style={{
                                textAlign: 'right',
                                color: event.gainLossUsd >= 0 ? '#10b981' : '#ef4444',
                                fontWeight: 'bold'
                              }}>
                                {event.gainLossUsd >= 0 ? '+' : ''}${event.gainLossUsd.toFixed(2)}
                              </td>
                              <td style={{
                                textAlign: 'right',
                                color: event.fiatCurrency !== 'USD' ? (event.gainLossUsd >= 0 ? '#10b981' : '#ef4444') : 'var(--muted)'
                              }}>
                                {event.fiatCurrency !== 'USD' ? (() => {
                                  const gainLossOriginal = event.gainLossUsd / event.fxFiatToUsd;
                                  return (gainLossOriginal >= 0 ? '+' : '') + gainLossOriginal.toFixed(2) + ' ' + event.fiatCurrency;
                                })() : '—'}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    try {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const url = `/api/tax/romania/export?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}&eventId=${event.transactionId}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`;
                                      triggerDownloadOnce(`tax-export-event-${event.transactionId}-${selectedTaxYear}-${selectedId || 'none'}`, url);
                                    } catch (error) {
                                      console.error('Export failed:', error);
                                    }
                                  }}
                                  className="btn btn-success btn-sm"
                                  title="Export this taxable event with source trace details"
                                >
                                  📄 Export
                                </button>
                              </td>
                            </tr>
                            {event.sourceTrace.length > 0 && (
                              <tr>
                                <td colSpan={7} style={{ padding: '0.75rem', backgroundColor: 'var(--background)', borderTop: '1px solid var(--border)' }}>
                                  <button
                                    onClick={() => setExpandedEventId(event.transactionId)}
                                    className="btn btn-secondary btn-sm"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '0.5rem',
                                      width: '100%',
                                      justifyContent: 'center'
                                    }}
                                  >
                                    <span>📊</span>
                                    <span>Source Trace & Flow Diagram ({event.sourceTrace.length} source{event.sourceTrace.length !== 1 ? 's' : ''})</span>
                                    <span style={{ marginLeft: 'auto' }}>⛶</span>
                                  </button>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : taxReport ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              backgroundColor: 'var(--surface)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)'
            }}>
              No taxable events (withdrawals to fiat) found for {selectedTaxYear}.
            </div>
          ) : null}
        </div>
      )}

      {/* Transaction Summary */}
      <section className="card" style={{ marginTop: '2rem' }}>
        <div className="card-header">
          <div className="card-title">
            <h2 style={{ margin: 0 }}>
              Recent Cash Transactions{selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}
            </h2>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Currency</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {fiatTxs
                .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
                .slice(0, 10)
                .map(tx => (
                  <tr key={tx.id}>
                    <td>{new Date(tx.datetime).toLocaleDateString()}</td>
                    <td>
                      <span className={`transaction-type-badge ${tx.type.toLowerCase()}`}>
                        {tx.type === 'Deposit' ? '💰' : '💸'} {tx.type}
                      </span>
                    </td>
                    <td style={{ color: colorFor(
                      (tx.type === 'Deposit' && tx.fromAsset ? tx.fromAsset : tx.toAsset).toUpperCase()
                    ), fontWeight: 600 }}>
                      {(tx.type === 'Deposit' && tx.fromAsset ? tx.fromAsset : tx.toAsset).toUpperCase()}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                      {(tx.type === 'Deposit' ? (tx.fromQuantity || 0) : (tx.toQuantity || 0)).toFixed(2)}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                      {tx.notes || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>—</span>}
                    </td>
                  </tr>
                ))}
              {fiatTxs.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '2rem' }}>📭</span>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>No cash transactions found</div>
                      <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Try adjusting your filters</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Source Trace & Flow Diagram Modal */}
      {expandedEventId !== null && taxReport && (() => {
        const event = taxReport.taxableEvents.find(e => e.transactionId === expandedEventId);
        if (!event) return null;

        return (
          <div
            className="modal-backdrop chart-modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setExpandedEventId(null)}
          >
            <div className="modal chart-modal" onClick={(e) => e.stopPropagation()}>
              <div className="chart-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                    Source Trace & Flow Diagram
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                    {event.sourceTrace.length} source{event.sourceTrace.length !== 1 ? 's' : ''} •
                    Withdrawal: ${event.fiatAmountUsd.toFixed(2)} •
                    P/L: <span style={{ color: event.gainLossUsd >= 0 ? '#10b981' : '#ef4444' }}>
                      {event.gainLossUsd >= 0 ? '+' : ''}${event.gainLossUsd.toFixed(2)}
                    </span>
                  </div>
                </div>
                <button type="button" className="icon-btn" title="Close" onClick={() => setExpandedEventId(null)}>
                  ✕
                </button>
              </div>
              <div className="chart-modal-body" style={{ padding: '1.5rem', overflowY: 'auto' }}>
                <SankeyExplorer event={event} transactions={txs} onTransactionClick={(txId) => {
                  console.log('Transaction clicked:', txId);
                }} />
              </div>
            </div>
          </div>
        );
      })()}
      </main>
    </AuthGuard>
  );
}
