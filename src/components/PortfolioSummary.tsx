import React from 'react';
import { PortfolioSummary as SummaryData, formatCurrency } from '@/lib/portfolio-utils';

interface PortfolioSummaryProps {
  summary: SummaryData;
}

export default function PortfolioSummary({ summary }: PortfolioSummaryProps) {
  const cards = [
    {
      label: 'Total Value',
      value: `$${formatCurrency(summary.totalValue, 2)}`,
      color: 'var(--text)'
    },
    {
      label: 'Total P&L',
      value: `${summary.totalPnl >= 0 ? '+' : ''}$${formatCurrency(summary.totalPnl, 2)}`,
      percentage: `${summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnlPercent.toFixed(2)}%`,
      color: summary.totalPnl >= 0 ? 'var(--success)' : 'var(--error)'
    },
    {
      label: 'Assets',
      value: summary.assetCount.toString(),
      color: 'var(--text)'
    }
  ];

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
      gap: '1rem', 
      marginBottom: '2rem' 
    }}>
      {cards.map((card, index) => (
        <div 
          key={index}
          style={{ 
            backgroundColor: 'var(--surface)', 
            padding: '1.5rem', 
            borderRadius: '8px', 
            border: '1px solid var(--border)' 
          }}
        >
          <div style={{ 
            color: 'var(--muted)', 
            fontSize: '0.9rem', 
            marginBottom: '0.5rem' 
          }}>
            {card.label}
          </div>
          <div style={{ 
            fontSize: '1.5rem', 
            fontWeight: 'bold',
            color: card.color
          }}>
            {card.value}
          </div>
          {card.percentage && (
            <div style={{ 
              fontSize: '0.9rem',
              color: card.color
            }}>
              {card.percentage}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
