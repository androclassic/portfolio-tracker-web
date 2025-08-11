import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import SWRProvider from './SWRProvider';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SWRProvider>
          <header className="topnav">
          <div className="brand">Portfolio Tracker</div>
          <nav className="nav">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/transactions">Transactions</Link>
          </nav>
          </header>
          <main className="container">{children}</main>
        </SWRProvider>
      </body>
    </html>
  );
}
