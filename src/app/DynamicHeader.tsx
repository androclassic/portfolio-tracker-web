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
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [portfolioDropdownOpen, setPortfolioDropdownOpen] = useState(false);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.dropdown-container')) {
        setUserDropdownOpen(false);
        setPortfolioDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
              {/* Portfolio Dropdown */}
              <div className="dropdown-container">
                <button 
                  className="dropdown-trigger"
                  onClick={() => setPortfolioDropdownOpen(!portfolioDropdownOpen)}
                >
                  <span>Portfolio</span>
                  <span className="dropdown-arrow">▼</span>
                </button>
                {portfolioDropdownOpen && (
                  <div className="dropdown-menu">
                    <Suspense fallback={<div className="loading-placeholder">Loading...</div>}>
                      <PortfolioSelector />
                    </Suspense>
                  </div>
                )}
              </div>

              {/* User Profile Dropdown */}
              <div className="dropdown-container">
                <button 
                  className="dropdown-trigger user-trigger"
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                >
                  <div className="user-avatar">
                    {session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || 'U'}
                  </div>
                  <span className="user-name">{session?.user?.name || session?.user?.email}</span>
                  <span className="dropdown-arrow">▼</span>
                </button>
                {userDropdownOpen && (
                  <div className="dropdown-menu user-menu">
                    <div className="user-info">
                      <div className="user-name">{session?.user?.name || session?.user?.email}</div>
                      <div className="user-email">{session?.user?.email}</div>
                    </div>
                    <div className="dropdown-divider"></div>
                    <Link href="/settings" className="dropdown-item">
                      Settings
                    </Link>
                    <button
                      className="dropdown-item logout-item"
                      onClick={handleLogout}
                      disabled={loggingOut}
                    >
                      {loggingOut ? 'Logging out...' : 'Logout'}
                    </button>
                  </div>
                )}
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
