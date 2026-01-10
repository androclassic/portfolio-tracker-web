import './globals.css';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import SWRProvider from './SWRProvider';
import PortfolioProvider from './PortfolioProvider';
import DynamicHeader from './DynamicHeader';
import SessionProvider from '@/components/SessionProvider';
import { MobileNavigation } from '@/components/MobileNavigation';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'Portfolio Tracker',
  description: 'Track your cryptocurrency portfolio',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SessionProvider>
          <SWRProvider>
            <PortfolioProvider>
              <DynamicHeader />
              <main className="container">{children}</main>
              <MobileNavigation />
            </PortfolioProvider>
          </SWRProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

// moved selector to its own file
