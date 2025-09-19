import React from 'react';
import { HoldingData, formatCurrency, formatBTC, formatMarketCap } from '@/lib/portfolio-utils';

interface HoldingsTableProps {
  holdings: HoldingData[];
}

export default function HoldingsTable({ holdings }: HoldingsTableProps) {
  return (
    <div style={{ 
      backgroundColor: 'var(--surface)', 
      borderRadius: '8px', 
      border: '1px solid var(--border)',
      overflow: 'hidden'
    }}>
      <div style={{ 
        padding: '1rem 1.5rem', 
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--background)'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600' }}>
          Holdings
        </h2>
      </div>
      
      <div style={{ overflowX: 'auto' }}>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse',
          fontSize: '0.9rem'
        }}>
          <thead>
            <tr style={{ 
              backgroundColor: 'var(--background)', 
              borderBottom: '1px solid var(--border)' 
            }}>
              {[
                { key: 'rank', label: '#', width: '60px' },
                { key: 'coin', label: 'Coin', width: '200px' },
                { key: 'price', label: 'Price', width: '120px' },
                { key: 'holdings', label: 'Holdings', width: '150px' },
                { key: 'marketCap', label: 'Market Cap', width: '120px' },
                { key: 'btcValue', label: 'BTC Value', width: '120px' },
                { key: 'pnl', label: 'P&L', width: '120px' }
              ].map(column => (
                <th 
                  key={column.key}
                  style={{ 
                    padding: '1rem 1.5rem', 
                    textAlign: column.key === 'coin' ? 'left' : 'right', 
                    fontWeight: '600',
                    color: 'var(--muted)',
                    fontSize: '0.8rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    width: column.width
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding, index) => (
              <tr key={holding.asset} style={{ 
                borderBottom: '1px solid var(--border)',
                transition: 'background-color 0.2s'
              }}>
                {/* Rank */}
                <td style={{ 
                  padding: '1rem 1.5rem', 
                  color: 'var(--muted)',
                  fontWeight: '500'
                }}>
                  {index + 1}
                </td>
                
                {/* Coin */}
                <td style={{ padding: '1rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: holding.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '0.8rem'
                    }}>
                      {holding.asset.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                        {holding.name}
                      </div>
                      <div style={{ 
                        color: 'var(--muted)', 
                        fontSize: '0.8rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        {holding.asset}
                      </div>
                    </div>
                  </div>
                </td>
                
                {/* Price */}
                <td style={{ 
                  padding: '1rem 1.5rem', 
                  textAlign: 'right',
                  fontWeight: '500'
                }}>
                  ${formatCurrency(holding.currentPrice, 2)}
                </td>
                
                {/* Holdings */}
                <td style={{ 
                  padding: '1rem 1.5rem', 
                  textAlign: 'right'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>
                    ${formatCurrency(holding.currentValue, 2)}
                  </div>
                  <div style={{ 
                    color: 'var(--muted)', 
                    fontSize: '0.8rem'
                  }}>
                    {formatCurrency(holding.quantity, 2)} {holding.asset}
                  </div>
                </td>
                
                {/* Market Cap */}
                <td style={{ 
                  padding: '1rem 1.5rem', 
                  textAlign: 'right',
                  fontWeight: '500'
                }}>
                  {formatMarketCap(holding.marketCap)}
                </td>
                
                {/* BTC Value */}
                <td style={{ 
                  padding: '1rem 1.5rem', 
                  textAlign: 'right',
                  fontWeight: '500'
                }}>
                  {holding.btcValue > 0 ? `${formatBTC(holding.btcValue)} BTC` : 'N/A'}
                </td>
                
                {/* P&L */}
                <td style={{ 
                  padding: '1rem 1.5rem', 
                  textAlign: 'right'
                }}>
                  <div style={{ 
                    fontWeight: '600',
                    color: holding.pnl >= 0 ? 'var(--success)' : 'var(--error)',
                    marginBottom: '0.25rem'
                  }}>
                    {holding.pnl >= 0 ? '+' : ''}${formatCurrency(holding.pnl, 2)}
                  </div>
                  <div style={{ 
                    color: holding.pnl >= 0 ? 'var(--success)' : 'var(--error)',
                    fontSize: '0.8rem'
                  }}>
                    {holding.pnl >= 0 ? '+' : ''}{holding.pnlPercent.toFixed(2)}%
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
