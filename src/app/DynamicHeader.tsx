'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSession, signOut } from 'next-auth/react';
import PortfolioSelector from './PortfolioSelector';
import ThemeToggle from './ThemeToggle';

export default function DynamicHeader() {
  const { data: session, status } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  const isAuthenticated = !!session;
  const loading = status === 'loading';

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    
    try {
      await signOut({ callbackUrl: '/login' });
    } catch (error) {
      console.error('Logout error:', error);
      // Fallback redirect
      window.location.href = '/login';
    } finally {
      setLoggingOut(false);
    }
  };

  if (loading) {
    // Show a minimal header while checking auth
    return (
      <header className="topnav">
        <div className="topnav-inner container">
          <div className="brand">Portfolio Tracker</div>
          <nav className="nav">
            <div style={{ opacity: 0.6 }}>Loading...</div>
          </nav>
        </div>
      </header>
    );
  }

  return (
    <header className="topnav">
      <div className="topnav-inner container">
        {/* Left section: Brand */}
        <div className="header-left">
          <div className="brand">Portfolio Tracker</div>
        </div>

        {/* Center section: Navigation */}
        {isAuthenticated && (
          <nav className="header-nav">
            <Link href="/overview">Overview</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/cash-dashboard">Cash</Link>
            <Link href="/transactions">Transactions</Link>
          </nav>
        )}

        {/* Right section: User controls */}
        <div className="header-right">
          {isAuthenticated ? (
            <>
              {/* User Profile Section with Portfolio */}
              <div className="user-profile">
                {/* Portfolio Selector */}
                <Suspense fallback={<div className="loading-placeholder">Loading...</div>}>
                  <PortfolioSelector />
                </Suspense>
                
                <div className="user-info">
                  <span className="user-name">{session?.user?.name || session?.user?.email}</span>
                  <span className="user-email">{session?.user?.email}</span>
                </div>
                <button 
                  className="btn btn-secondary btn-sm" 
                  onClick={handleLogout}
                  disabled={loggingOut}
                  title="Logout"
                >
                  {loggingOut ? 'Logging out...' : 'Logout'}
                </button>
              </div>
            </>
          ) : (
            <nav className="header-nav">
              <Link href="/login">Login</Link>
              <Link href="/register">Register</Link>
            </nav>
          )}
          
          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
