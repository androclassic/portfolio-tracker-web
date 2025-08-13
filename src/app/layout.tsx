import './globals.css';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import SWRProvider from './SWRProvider';
import PortfolioProvider from './PortfolioProvider';
import DynamicHeader from './DynamicHeader';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SWRProvider>
          <PortfolioProvider>
            <DynamicHeader />
            <main className="container">{children}</main>
          </PortfolioProvider>
        </SWRProvider>
      </body>
    </html>
  );
}

// moved selector to its own file
