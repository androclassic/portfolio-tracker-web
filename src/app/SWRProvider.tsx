'use client';

import { SWRConfig, useSWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

function SWREventBridge(){
  const { mutate } = useSWRConfig();

  useEffect(()=>{
    const onTxChange = () => {
      // Clear any local historical caches so charts recompute from fresh prices
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('hist:')) {
            localStorage.removeItem(k);
          }
        }
      } catch {}
      // Revalidate any keys related to transactions, prices, and historical data
      mutate(
        (key: unknown) => typeof key === 'string' && (
          key.startsWith('/api/transactions') ||
          key.startsWith('/api/prices') ||
          key.startsWith('hist:')
        ),
        undefined,
        { revalidate: true }
      );
    };
    window.addEventListener('transactions-changed', onTxChange);
    return () => window.removeEventListener('transactions-changed', onTxChange);
  }, [mutate]);

  return null;
}

export default function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 60_000,
    }}>
      <SWREventBridge />
      {children}
    </SWRConfig>
  );
}


