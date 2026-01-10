'use client';

import { useEffect, useMemo, useState } from 'react';

type PlotlyTheme = {
  layoutDefaults: Record<string, unknown>;
  configDefaults: Record<string, unknown>;
};

function readCssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v || '').trim();
}

function hexToRgba(hex: string, alpha: number): string | null {
  const h = hex.trim();
  if (!h.startsWith('#')) return null;
  const raw = h.slice(1);
  const isShort = raw.length === 3;
  const isLong = raw.length === 6;
  if (!isShort && !isLong) return null;
  const rr = isShort ? raw[0] + raw[0] : raw.slice(0, 2);
  const gg = isShort ? raw[1] + raw[1] : raw.slice(2, 4);
  const bb = isShort ? raw[2] + raw[2] : raw.slice(4, 6);
  const r = parseInt(rr, 16);
  const g = parseInt(gg, 16);
  const b = parseInt(bb, 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildTheme(): PlotlyTheme {
  const text = readCssVar('--text') || '#e8eeff';
  const muted = readCssVar('--muted') || '#a3b1d1';
  const border = readCssVar('--border') || '#1e2a4a';
  const card = readCssVar('--card') || readCssVar('--surface') || '#132446';
  const primary = readCssVar('--primary') || '#5b8cff';
  const accent = readCssVar('--accent') || '#22d3ee';
  const success = readCssVar('--success') || '#16a34a';
  const warning = readCssVar('--warning') || '#f59e0b';
  const danger = readCssVar('--danger') || '#dc2626';

  const grid = hexToRgba(border, 0.35) ?? border;
  const hoverBg = hexToRgba(card, 0.98) ?? card;
  const hoverBorder = hexToRgba(border, 0.85) ?? border;

  const transparent = 'rgba(0,0,0,0)';

  return {
    layoutDefaults: {
      paper_bgcolor: transparent,
      plot_bgcolor: transparent,
      autosize: true,
      font: {
        family: 'inherit',
        color: text,
        size: 12,
      },
      colorway: [primary, accent, success, warning, danger],
      margin: { t: 36, r: 14, l: 44, b: 40 },
      legend: {
        orientation: 'h',
        bgcolor: transparent,
        font: { color: text },
      },
      hoverlabel: {
        bgcolor: hoverBg,
        bordercolor: hoverBorder,
        font: { color: text, family: 'inherit' },
      },
      xaxis: {
        color: muted,
        gridcolor: grid,
        zerolinecolor: grid,
        linecolor: border,
        tickcolor: border,
      },
      yaxis: {
        color: muted,
        gridcolor: grid,
        zerolinecolor: grid,
        linecolor: border,
        tickcolor: border,
      },
    },
    configDefaults: {
      responsive: true,
      displaylogo: false,
      displayModeBar: true, // Enable modebar by default for zoom controls
      modeBarButtonsToRemove: [
        'zoom2d',
        'pan2d',
        'lasso2d',
        'select2d',
        'zoomIn2d',
        'zoomOut2d',
        'resetScale2d',
        'hoverClosestCartesian',
        'hoverCompareCartesian',
        'toggleHover',
        'toImage',
      ],
      // Keep only: autoScale2d (autofit/zoom out)
    },
  };
}

export function usePlotlyTheme(): PlotlyTheme {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const recompute = () => setVersion((v) => v + 1);

    // Recompute when the manual theme attribute changes.
    const obs = new MutationObserver(recompute);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Recompute when system theme changes and the app is in "system" mode.
    const mql = window.matchMedia?.('(prefers-color-scheme: light)');
    const onMql = () => recompute();
    if (mql?.addEventListener) mql.addEventListener('change', onMql);
    else if (mql?.addListener) mql.addListener(onMql);

    return () => {
      obs.disconnect();
      if (mql?.removeEventListener) mql.removeEventListener('change', onMql);
      else if (mql?.removeListener) mql.removeListener(onMql);
    };
  }, []);

  return useMemo(() => {
    void version;
    return buildTheme();
  }, [version]);
}


