'use client';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useCallback, useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, getFiatCurrencies, convertFiat } from '@/lib/assets';

import type { Layout, Data } from 'plotly.js';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

const fetcher = jsonFetcher;

export default function CashDashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [selectedTaxYear, setSelectedTaxYear] = useState<string>('all'); // 'all' | '2024' | '2023' | etc.

  // Filter for fiat currency transactions only
  const fiatTxs = useMemo(() => {
    const fiatCurrencies = getFiatCurrencies();
    return (txs || []).filter(tx => {
      const isFiat = fiatCurrencies.includes(tx.asset.toUpperCase());
      const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
      
      if (!isFiat || !isCashTransaction) return false;
      
      // Apply tax year filter
      if (selectedTaxYear !== 'all') {
        const txYear = new Date(tx.datetime).getFullYear().toString();
        return txYear === selectedTaxYear;
      }
      
      return true;
    });
  }, [txs, selectedTaxYear]);

  const fiatCurrencies = getFiatCurrencies();

  // Get available tax years from all fiat transactions
  const availableTaxYears = useMemo(() => {
    const fiatCurrencies = getFiatCurrencies();
    const allFiatTxs = (txs || []).filter(tx => 
      fiatCurrencies.includes(tx.asset.toUpperCase()) && 
      (tx.type === 'Deposit' || tx.type === 'Withdrawal')
    );
    
    const years = new Set<string>();
    allFiatTxs.forEach(tx => {
      const year = new Date(tx.datetime).getFullYear().toString();
      years.add(year);
    });
    
    return ['all', ...Array.from(years).sort((a, b) => b.localeCompare(a))];
  }, [txs]);

  // Calculate cash flow data
  const cashFlowData = useMemo(() => {
    const data: { [key: string]: { deposits: number; withdrawals: number; balance: number; dates: string[] } } = {};
    
    fiatCurrencies.forEach(currency => {
      data[currency] = {
        deposits: 0,
        withdrawals: 0,
        balance: 0,
        dates: []
      };
    });

    // Sort transactions by date
    const sortedTxs = [...fiatTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    
    sortedTxs.forEach(tx => {
      const currency = tx.asset.toUpperCase();
      const amount = tx.quantity;
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      
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

  // Calculate running balance over time
  const balanceOverTime = useMemo(() => {
    const currency = selectedCurrency;
    const currencyTxs = fiatTxs.filter(tx => tx.asset.toUpperCase() === currency);
    const sortedTxs = [...currencyTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    
    const dates: string[] = [];
    const balances: number[] = [];
    let runningBalance = 0;
    
    sortedTxs.forEach(tx => {
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      const amount = tx.quantity;
      
      if (tx.type === 'Deposit') {
        runningBalance += amount;
      } else if (tx.type === 'Withdrawal') {
        runningBalance -= amount;
      }
      
      dates.push(date);
      balances.push(runningBalance);
    });
    
    return { dates, balances };
  }, [fiatTxs, selectedCurrency]);

  // Calculate monthly cash flow
  const monthlyCashFlow = useMemo(() => {
    const currency = selectedCurrency;
    const currencyTxs = fiatTxs.filter(tx => tx.asset.toUpperCase() === currency);
    
    const monthlyData: { [key: string]: { deposits: number; withdrawals: number } } = {};
    
    currencyTxs.forEach(tx => {
      const date = new Date(tx.datetime);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { deposits: 0, withdrawals: 0 };
      }
      
      if (tx.type === 'Deposit') {
        monthlyData[monthKey].deposits += tx.quantity;
      } else if (tx.type === 'Withdrawal') {
        monthlyData[monthKey].withdrawals += tx.quantity;
      }
    });
    
    const months = Object.keys(monthlyData).sort();
    const deposits = months.map(month => monthlyData[month].deposits);
    const withdrawals = months.map(month => monthlyData[month].withdrawals);
    
    return { months, deposits, withdrawals };
  }, [fiatTxs, selectedCurrency]);

  // Calculate total balances in USD equivalent
  const totalBalances = useMemo(() => {
    const totals: { [key: string]: number } = {};
    
    fiatCurrencies.forEach(currency => {
      const currencyTxs = fiatTxs.filter(tx => tx.asset.toUpperCase() === currency);
      let balance = 0;
      
      currencyTxs.forEach(tx => {
        if (tx.type === 'Deposit') {
          balance += tx.quantity;
        } else if (tx.type === 'Withdrawal') {
          balance -= tx.quantity;
        }
      });
      
      // Convert to USD for comparison
      const usdBalance = convertFiat(balance, currency, 'USD');
      totals[currency] = usdBalance;
    });
    
    return totals;
  }, [fiatTxs, fiatCurrencies]);

  const colorFor = useCallback((asset: string): string => {
    return getAssetColor(asset);
  }, []);

  // Cash Flow Chart (Deposits vs Withdrawals)
  const cashFlowChart: Data[] = [
    {
      x: fiatCurrencies,
      y: fiatCurrencies.map(currency => cashFlowData[currency].deposits),
      type: 'bar',
      name: 'Deposits',
      marker: { color: '#10b981' },
    },
    {
      x: fiatCurrencies,
      y: fiatCurrencies.map(currency => cashFlowData[currency].withdrawals),
      type: 'bar',
      name: 'Withdrawals',
      marker: { color: '#ef4444' },
    },
  ];

  const cashFlowLayout: Partial<Layout> = {
    title: { text: `Cash Flow by Currency${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Currency' } },
    yaxis: { title: { text: 'Amount' } },
    barmode: 'group',
    height: 400,
  };

  // Balance Over Time Chart
  const balanceOverTimeChart: Data[] = [
    {
      x: balanceOverTime.dates,
      y: balanceOverTime.balances,
      type: 'scatter',
      mode: 'lines+markers',
      name: `${selectedCurrency} Balance`,
      line: { color: colorFor(selectedCurrency) },
      marker: { size: 6 },
    },
  ];

  const balanceOverTimeLayout: Partial<Layout> = {
    title: { text: `${selectedCurrency} Balance Over Time${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Date' } },
    yaxis: { title: { text: `${selectedCurrency} Balance` } },
    height: 400,
  };

  // Monthly Cash Flow Chart
  const monthlyCashFlowChart: Data[] = [
    {
      x: monthlyCashFlow.months,
      y: monthlyCashFlow.deposits,
      type: 'bar',
      name: 'Deposits',
      marker: { color: '#10b981' },
    },
    {
      x: monthlyCashFlow.months,
      y: monthlyCashFlow.withdrawals,
      type: 'bar',
      name: 'Withdrawals',
      marker: { color: '#ef4444' },
    },
  ];

  const monthlyCashFlowLayout: Partial<Layout> = {
    title: { text: `Monthly Cash Flow - ${selectedCurrency}${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Month' } },
    yaxis: { title: { text: `${selectedCurrency} Amount` } },
    barmode: 'group',
    height: 400,
  };

  // Total Balances Pie Chart
  const totalBalancesChart: Data[] = [
    {
      labels: fiatCurrencies,
      values: fiatCurrencies.map(currency => totalBalances[currency]),
      type: 'pie',
      marker: {
        colors: fiatCurrencies.map(currency => colorFor(currency)),
      },
    },
  ];

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
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>💰 Cash Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Track your fiat currency deposits, withdrawals, and cash flow over time.
        </p>
        
        {/* Filters */}
        <div style={{ marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <label style={{ marginRight: '1rem', fontWeight: 'bold' }}>Currency:</label>
            <select 
              value={selectedCurrency} 
              onChange={(e) => setSelectedCurrency(e.target.value)}
              style={{ 
                padding: '0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)'
              }}
            >
              {fiatCurrencies.map(currency => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label style={{ marginRight: '1rem', fontWeight: 'bold' }}>Tax Year:</label>
            <select 
              value={selectedTaxYear} 
              onChange={(e) => setSelectedTaxYear(e.target.value)}
              style={{ 
                padding: '0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)'
              }}
            >
              {availableTaxYears.map(year => (
                <option key={year} value={year}>
                  {year === 'all' ? 'All Years' : year}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '1rem', 
          marginBottom: '2rem' 
        }}>
          {fiatCurrencies.map(currency => {
            const data = cashFlowData[currency];
            const totalDeposits = data.deposits;
            const totalWithdrawals = data.withdrawals;
            const netFlow = totalDeposits - totalWithdrawals;
            
            return (
              <div 
                key={currency}
                style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--surface)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  textAlign: 'center'
                }}
              >
                <h3 style={{ margin: '0 0 0.5rem 0', color: colorFor(currency) }}>{currency}</h3>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  <div>Deposits: {totalDeposits.toFixed(2)}</div>
                  <div>Withdrawals: {totalWithdrawals.toFixed(2)}</div>
                  <div style={{ 
                    fontWeight: 'bold', 
                    color: netFlow >= 0 ? '#10b981' : '#ef4444',
                    marginTop: '0.5rem'
                  }}>
                    Net: {netFlow.toFixed(2)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', 
        gap: '2rem' 
      }}>
        {/* Cash Flow by Currency */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={cashFlowChart} layout={cashFlowLayout} />
        </div>

        {/* Balance Over Time */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={balanceOverTimeChart} layout={balanceOverTimeLayout} />
        </div>

        {/* Monthly Cash Flow */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={monthlyCashFlowChart} layout={monthlyCashFlowLayout} />
        </div>

        {/* Total Balances Pie Chart */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={totalBalancesChart} layout={totalBalancesLayout} />
        </div>
      </div>

      {/* Transaction Summary */}
      <div style={{ marginTop: '2rem' }}>
        <h2>Recent Cash Transactions{selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}</h2>
        <div style={{ 
          backgroundColor: 'var(--surface)', 
          borderRadius: '8px', 
          border: '1px solid var(--border)',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--background)' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Date</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Type</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Currency</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {fiatTxs
                .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
                .slice(0, 10)
                .map(tx => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem' }}>
                      {new Date(tx.datetime).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{ 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px', 
                        fontSize: '0.8rem',
                        backgroundColor: tx.type === 'Deposit' ? '#10b98120' : '#ef444420',
                        color: tx.type === 'Deposit' ? '#10b981' : '#ef4444'
                      }}>
                        {tx.type}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', color: colorFor(tx.asset.toUpperCase()) }}>
                      {tx.asset.toUpperCase()}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>
                      {tx.quantity.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>
                      {tx.notes || '-'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
