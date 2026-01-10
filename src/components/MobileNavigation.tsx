'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/overview', label: 'Overview', icon: '📈' },
  { href: '/transactions', label: 'Transactions', icon: '💰' },
  { href: '/cash-dashboard', label: 'Cash', icon: '💵' },
];

export function MobileNavigation() {
  const pathname = usePathname();

  return (
    <nav className="mobile-nav">
      {navItems.map((item) => {
        const isActive = pathname === item.href ||
          (item.href === '/dashboard' && pathname === '/') ||
          (item.href !== '/dashboard' && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
