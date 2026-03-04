'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';

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

function buildTheme(): EChartsOption {
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
  const tooltipBg = hexToRgba(card, 0.98) ?? card;
  const tooltipBorder = hexToRgba(border, 0.85) ?? border;

  return {
    backgroundColor: 'transparent',
    color: [primary, accent, success, warning, danger],
    textStyle: {
      fontFamily: 'inherit',
      color: text,
      fontSize: 12,
    },
    grid: {
      top: 36,
      right: 14,
      left: 44,
      bottom: 40,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: text, fontSize: 12 },
      axisPointer: {
        type: 'cross',
        lineStyle: { color: muted, type: 'dashed' },
        crossStyle: { color: muted },
      },
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      textStyle: { color: text },
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 8,
    },
    xAxis: {
      axisLine: { lineStyle: { color: border } },
      axisTick: { lineStyle: { color: border } },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: grid, type: 'dashed' } },
    },
    yAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: grid, type: 'dashed' } },
    },
  };
}

export function useEChartsTheme(): EChartsOption {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const recompute = () => setVersion((v) => v + 1);

    const obs = new MutationObserver(recompute);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const mql = window.matchMedia?.('(prefers-color-scheme: light)');
    const onMql = () => recompute();
    if (mql?.addEventListener) mql.addEventListener('change', onMql);

    return () => {
      obs.disconnect();
      if (mql?.removeEventListener) mql.removeEventListener('change', onMql);
    };
  }, []);

  return useMemo(() => {
    void version;
    return buildTheme();
  }, [version]);
}
