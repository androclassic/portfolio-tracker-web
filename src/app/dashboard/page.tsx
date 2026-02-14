'use client';
import React from 'react';
import AuthGuard from '@/components/AuthGuard';
import DashboardDataProvider from '../DashboardDataProvider';
import { SummaryCards } from './components/SummaryCards';
import { HeatmapChart } from './components/HeatmapChart';
import { AllocationChart } from './components/AllocationChart';
import { NetWorthChart } from './components/NetWorthChart';
import { CostVsValuationChart } from './components/CostVsValuationChart';
import { StackedCompositionChart } from './components/StackedCompositionChart';
import { PnLChart } from './components/PnLChart';
import { BtcRatioChart } from './components/BtcRatioChart';
import { AltcoinVsBtcChart } from './components/AltcoinVsBtcChart';
import { ProfitOpportunitiesChart } from './components/ProfitOpportunitiesChart';
import { CostVsPriceChart } from './components/CostVsPriceChart';
import { PositionsChart } from './components/PositionsChart';

function DashboardPageContent() {
  return (
    <AuthGuard>
      <main className="dashboard-container">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">Portfolio Dashboard</h1>
            <p className="dashboard-subtitle">Track your crypto investments and performance</p>
          </div>
        </div>

        <SummaryCards />

        <div className="chart-grid">
          <HeatmapChart />
          <AllocationChart />
          <NetWorthChart />
          <CostVsValuationChart />
          <StackedCompositionChart />
          <PnLChart />
          <BtcRatioChart />
          <AltcoinVsBtcChart />
          <ProfitOpportunitiesChart />
          <CostVsPriceChart />
          <PositionsChart />
        </div>
      </main>
    </AuthGuard>
  );
}

export default function DashboardPage() {
  return (
    <DashboardDataProvider>
      <DashboardPageContent />
    </DashboardDataProvider>
  );
}
