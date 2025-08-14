'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import PortfolioSelector from './PortfolioSelector';
import ThemeToggle from './ThemeToggle';

export default function DynamicHeader() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check authentication status by making a request to a protected endpoint
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/portfolios', { 
          credentials: 'include',
          cache: 'no-store' 
        });
        setIsAuthenticated(response.ok);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    // Listen for auth changes (custom events from login/logout)
    const handleAuthChange = () => {
      checkAuth();
    };

    window.addEventListener('auth-changed', handleAuthChange);
    return () => window.removeEventListener('auth-changed', handleAuthChange);
  }, []);

  if (loading) {
    // Show a minimal header while checking auth
    return (
      <header className="topnav">
        <div className="brand">Portfolio Tracker</div>
        <nav className="nav">
          <div style={{ opacity: 0.6 }}>Loading...</div>
        </nav>
      </header>
    );
  }

  return (
    <header className="topnav">
      <div className="brand">Portfolio Tracker</div>
      <nav className="nav">
        {isAuthenticated ? (
          <>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/transactions">Transactions</Link>
            <form action="/api/auth/logout" method="POST" style={{ display:'inline' }} onSubmit={() => {
              // Notify components about logout to clear data
              window.dispatchEvent(new CustomEvent('auth-changed'));
            }}>
              <button className="btn btn-secondary" style={{ marginLeft: 8 }} type="submit">Logout</button>
            </form>
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
    </header>
  );
}
