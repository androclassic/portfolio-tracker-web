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
        <div className="brand">Portfolio Tracker</div>
        <nav className="nav">
          {isAuthenticated ? (
            <>
              <Link href="/overview">Overview</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/cash-dashboard">Cash Dashboard</Link>
              <Link href="/transactions">Transactions</Link>
              <button 
                className="btn btn-secondary" 
                style={{ marginLeft: 8 }} 
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? 'Logging out...' : 'Logout'}
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Login</Link>
              <Link href="/register">Register</Link>
            </>
          )}
          <ThemeToggle />
        </nav>
        {isAuthenticated && (
          <Suspense fallback={<div>Loading portfolio...</div>}>
            <PortfolioSelector />
          </Suspense>
        )}
      </div>
    </header>
  );
}
