'use client';

import React, { useMemo, useState } from 'react';
import { TimeframeSelector } from '@/components/TimeframeSelector';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { DashboardTimeframe } from '@/lib/timeframe';

export function ChartCard(props: {
  title: string;
  infoText?: string;
  /**
   * Enable per-card timeframe control. Defaults to true.
   */
  timeframeEnabled?: boolean;
  defaultTimeframe?: DashboardTimeframe;
  /**
   * Render chart/body content. It will be rendered both in-card and in the modal (when expanded).
   */
  children: (ctx: { timeframe: DashboardTimeframe; expanded: boolean }) => React.ReactNode;
  /**
   * Optional extra header actions (to the right, before maximize).
   */
  headerActions?: (ctx: { timeframe: DashboardTimeframe; setTimeframe: (v: DashboardTimeframe) => void; expanded: boolean }) => React.ReactNode;
  /**
   * Optional footer content below the chart.
   */
  footer?: React.ReactNode;
  /**
   * Card style overrides (rare).
   */
  style?: React.CSSProperties;
}) {
  const { title, infoText, headerActions, timeframeEnabled: tfEnabled, defaultTimeframe, children, footer, style } = props;
  const timeframeEnabled = tfEnabled ?? true;
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>(defaultTimeframe ?? 'all');
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();

  const header = useMemo(() => {
    return (
      <div
        className="card-header"
        onClick={() => isMobile && setCollapsed(!collapsed)}
        style={{ cursor: isMobile ? 'pointer' : 'default' }}
      >
        <div className="card-title">
          <h2>{title}</h2>
          {infoText && !isMobile ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                alert(infoText);
              }}
              className="icon-btn"
              title="Chart Information"
              type="button"
            >
              ℹ️
            </button>
          ) : null}
        </div>
        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          {!collapsed && (
            <>
              {timeframeEnabled ? <TimeframeSelector value={timeframe} onChange={setTimeframe} /> : null}
              {headerActions ? headerActions({ timeframe, setTimeframe, expanded: false }) : null}
            </>
          )}
          {/* Collapse/expand button */}
          <button
            type="button"
            className="icon-btn"
            title={collapsed ? "Expand chart" : "Collapse chart"}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
          >
            {collapsed ? '▼' : '▲'}
          </button>

          {/* Maximize button - available on both mobile and desktop */}
          <button
            type="button"
            className="icon-btn"
            title="Maximize chart"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            ⛶
          </button>
        </div>
      </div>
    );
  }, [title, infoText, headerActions, timeframeEnabled, timeframe, collapsed, isMobile]);

  return (
    <>
      <section className={`card chart-card ${collapsed ? 'chart-card-collapsed' : ''}`} style={style}>
        {header}
        {!collapsed && (
          <>
            <div className="chart-card-body">{children({ timeframe, expanded: false })}</div>
            {footer ? <div className="chart-card-footer">{footer}</div> : null}
          </>
        )}
      </section>

      {expanded ? (
        <div
          className="modal-backdrop chart-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpanded(false)}
        >
          <div className="modal chart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chart-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{title}</div>
                {timeframeEnabled ? <TimeframeSelector value={timeframe} onChange={setTimeframe} /> : null}
                {headerActions ? headerActions({ timeframe, setTimeframe, expanded: true }) : null}
              </div>
              <button type="button" className="icon-btn" title="Close" onClick={() => setExpanded(false)}>
                ✕
              </button>
            </div>
            <div className="chart-modal-body">{children({ timeframe, expanded: true })}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}


