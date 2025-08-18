'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Suspense } from 'react';
import PortfolioSelector from './PortfolioSelector';
import ThemeToggle from './ThemeToggle';

export default function DynamicHeader() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

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

  const handleLogout = async () => {
    if (loggingOut) return;
    
    setLoggingOut(true);
    
    try {
      // Call logout API
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (response.ok) {
        // Clear local state immediately
        setIsAuthenticated(false);
        
        // Notify other components about logout
        window.dispatchEvent(new CustomEvent('auth-changed'));
        
        // Small delay to let components clear their state, then redirect
        setTimeout(() => {
          window.location.href = '/login';
        }, 100);
      } else {
        console.error('Logout failed');
        // Still try to clear local state and redirect
        setIsAuthenticated(false);
        window.dispatchEvent(new CustomEvent('auth-changed'));
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Logout error:', error);
      // Still try to clear local state and redirect
      setIsAuthenticated(false);
      window.dispatchEvent(new CustomEvent('auth-changed'));
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
              <Link href="/dashboard">Dashboard</Link>
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
