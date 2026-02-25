'use client';
import React from 'react';
import { HoldingData, formatCurrency, formatBTC } from '@/lib/portfolio-utils';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface HoldingsTableProps {
  holdings: HoldingData[];
}

export default function HoldingsTable({ holdings }: HoldingsTableProps) {
  const isMobile = useIsMobile();

  return (
    <div style={{
      backgroundColor: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
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

      {isMobile ? (
        <MobileHoldings holdings={holdings} />
      ) : (
        <DesktopTable holdings={holdings} />
      )}
    </div>
  );
}

function MobileHoldings({ holdings }: { holdings: HoldingData[] }) {
  return (
    <div style={{ padding: '0.5rem' }}>
      {holdings.map((holding) => {
        const pnlPositive = holding.pnl >= 0;
        const pnlColor = pnlPositive ? 'var(--success)' : 'var(--danger)';
        const pnlSign = pnlPositive ? '+' : '-';

        return (
          <div
            key={holding.asset}
            style={{
              padding: '1rem',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {/* Top row: coin info + current value */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '0.5rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: holding.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                  flexShrink: 0,
                }}>
                  {holding.asset.charAt(0)}
                </div>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>
                    {holding.name}
                  </div>
                  <div style={{
                    color: 'var(--muted)',
                    fontSize: '0.8rem',
                    textTransform: 'uppercase',
                  }}>
                    {holding.asset} · ${formatCurrency(holding.currentPrice, 2)}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: '600', fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
                  ${formatCurrency(holding.currentValue, 2)}
                </div>
                <div style={{
                  color: 'var(--muted)',
                  fontSize: '0.8rem',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatQuantity(holding.quantity)} {holding.asset}
                </div>
              </div>
            </div>

            {/* Bottom row: P&L */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.5rem',
              alignItems: 'center',
            }}>
              <span style={{
                fontWeight: '600',
                fontSize: '0.85rem',
                color: pnlColor,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {pnlSign}${formatCurrency(Math.abs(holding.pnl), 2)}
              </span>
              <span style={{
                display: 'inline-block',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: pnlColor,
                background: `color-mix(in oklab, ${pnlColor} 12%, transparent)`,
              }}>
                {pnlSign}{holding.pnlPercent.toFixed(2)}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DesktopTable({ holdings }: { holdings: HoldingData[] }) {
  return (
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
              { key: 'rank', label: '#', align: 'left' as const },
              { key: 'coin', label: 'Coin', align: 'left' as const },
              { key: 'price', label: 'Price', align: 'right' as const },
              { key: 'holdings', label: 'Holdings', align: 'right' as const },
              { key: 'btcValue', label: 'BTC Value', align: 'right' as const },
              { key: 'pnl', label: 'P&L', align: 'right' as const }
            ].map(column => (
              <th
                key={column.key}
                style={{
                  padding: '0.85rem 1.5rem',
                  textAlign: column.align,
                  fontWeight: '600',
                  color: 'var(--muted)',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding, index) => {
            const pnlPositive = holding.pnl >= 0;
            const pnlColor = pnlPositive ? 'var(--success)' : 'var(--danger)';
            const pnlSign = pnlPositive ? '+' : '-';

            return (
              <tr key={holding.asset} style={{
                borderBottom: '1px solid var(--border)',
                transition: 'background-color 0.15s',
              }}>
                <td style={{ padding: '1rem 1.5rem', color: 'var(--muted)', fontWeight: '500', width: '48px' }}>
                  {index + 1}
                </td>
                <td style={{ padding: '1rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      backgroundColor: holding.color,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '0.8rem',
                      flexShrink: 0,
                    }}>
                      {holding.asset.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600' }}>{holding.name}</div>
                      <div style={{ color: 'var(--muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {holding.asset}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '1rem 1.5rem', textAlign: 'right', fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
                  ${formatCurrency(holding.currentPrice, 2)}
                </td>
                <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                  <div style={{ fontWeight: '600', fontVariantNumeric: 'tabular-nums' }}>
                    ${formatCurrency(holding.currentValue, 2)}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>
                    {formatQuantity(holding.quantity)} {holding.asset}
                  </div>
                </td>
                <td style={{ padding: '1rem 1.5rem', textAlign: 'right', fontWeight: '500', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {holding.btcValue > 0 ? `${formatBTC(holding.btcValue, 4)} BTC` : '—'}
                </td>
                <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                  <div style={{ fontWeight: '600', color: pnlColor, fontVariantNumeric: 'tabular-nums' }}>
                    {pnlSign}${formatCurrency(Math.abs(holding.pnl), 2)}
                  </div>
                  <div style={{
                    display: 'inline-block',
                    marginTop: '2px',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: pnlColor,
                    background: `color-mix(in oklab, ${pnlColor} 12%, transparent)`,
                  }}>
                    {pnlSign}{holding.pnlPercent.toFixed(2)}%
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatQuantity(qty: number): string {
  if (qty >= 1000) return qty.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (qty >= 1) return qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (qty >= 0.01) return qty.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return qty.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
