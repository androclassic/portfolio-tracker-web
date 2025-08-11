import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import SWRProvider from './SWRProvider';
import PortfolioProvider from './PortfolioProvider';
import PortfolioSelector from './PortfolioSelector';
import { Suspense } from 'react';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SWRProvider>
          <PortfolioProvider>
          <header className="topnav">
          <div className="brand">Portfolio Tracker</div>
          <nav className="nav">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/transactions">Transactions</Link>
          </nav>
          <Suspense>
            <PortfolioSelector />
          </Suspense>
          </header>
          <main className="container">{children}</main>
          </PortfolioProvider>
        </SWRProvider>
      </body>
    </html>
  );
}

// moved selector to its own file
