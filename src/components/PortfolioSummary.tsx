import React from 'react';
import { PortfolioSummary as SummaryData, formatCurrency } from '@/lib/portfolio-utils';

interface PortfolioSummaryProps {
  summary: SummaryData;
}

export default function PortfolioSummary({ summary }: PortfolioSummaryProps) {
  const pnlIsPositive = summary.totalPnl >= 0;
  const pnlColor = pnlIsPositive ? 'var(--success)' : 'var(--danger)';
  const pnlSign = pnlIsPositive ? '+' : '-';
  const pnlBg = pnlIsPositive
    ? 'var(--success-50)'
    : 'var(--danger-50)';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '1rem',
      marginBottom: '2rem'
    }}>
      {/* Total Value — primary card */}
      <div style={{
        padding: '1.5rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-600) 100%)',
        color: '#fff',
      }}>
        <div style={{ fontSize: '0.85rem', opacity: 0.85, marginBottom: '0.5rem' }}>
          Total Value
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          ${formatCurrency(summary.totalValue, 2)}
        </div>
      </div>

      {/* P&L — color-coded card */}
      <div style={{
        padding: '1.5rem',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid color-mix(in oklab, ${pnlColor} 30%, transparent)`,
        background: pnlBg,
      }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
          Total P&L
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: pnlColor, letterSpacing: '-0.02em' }}>
          {pnlSign}${formatCurrency(Math.abs(summary.totalPnl), 2)}
        </div>
        <div style={{
          display: 'inline-block',
          marginTop: '0.35rem',
          padding: '2px 8px',
          borderRadius: '6px',
          fontSize: '0.8rem',
          fontWeight: 600,
          color: pnlColor,
          background: `color-mix(in oklab, ${pnlColor} 12%, transparent)`,
        }}>
          {pnlSign}{summary.totalPnlPercent.toFixed(2)}%
        </div>
      </div>

      {/* Assets count */}
      <div style={{
        padding: '1.5rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
      }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>
          Assets
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
          {summary.assetCount}
        </div>
      </div>
    </div>
  );
}
