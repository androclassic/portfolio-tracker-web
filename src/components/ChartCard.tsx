'use client';

import React, { useMemo, useState } from 'react';
import { TimeframeSelector } from '@/components/TimeframeSelector';
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
  const timeframeEnabled = props.timeframeEnabled ?? true;
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>(props.defaultTimeframe ?? 'all');
  const [expanded, setExpanded] = useState(false);

  const header = useMemo(() => {
    return (
      <div className="card-header">
        <div className="card-title">
          <h2>{props.title}</h2>
          {props.infoText ? (
            <button
              onClick={() => alert(props.infoText)}
              className="icon-btn"
              title="Chart Information"
              type="button"
            >
              ℹ️
            </button>
          ) : null}
        </div>
        <div className="card-actions">
          {timeframeEnabled ? <TimeframeSelector value={timeframe} onChange={setTimeframe} /> : null}
          {props.headerActions ? props.headerActions({ timeframe, setTimeframe, expanded }) : null}
          <button
            type="button"
            className="icon-btn"
            title="Maximize chart"
            onClick={() => setExpanded(true)}
          >
            ⛶
          </button>
        </div>
      </div>
    );
  }, [props.title, props.infoText, props.headerActions, timeframeEnabled, timeframe, expanded]);

  return (
    <>
      <section className="card" style={props.style}>
        {header}
        <div className="chart-card-body">{props.children({ timeframe, expanded: false })}</div>
        {props.footer ? <div className="chart-card-footer">{props.footer}</div> : null}
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
                <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>{props.title}</div>
                {timeframeEnabled ? <TimeframeSelector value={timeframe} onChange={setTimeframe} /> : null}
                {props.headerActions ? props.headerActions({ timeframe, setTimeframe, expanded: true }) : null}
              </div>
              <button type="button" className="icon-btn" title="Close" onClick={() => setExpanded(false)}>
                ✕
              </button>
            </div>
            <div className="chart-modal-body">{props.children({ timeframe, expanded: true })}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}


