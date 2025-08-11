'use client';

import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';

export default function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig value={{
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      dedupingInterval: 60_000,
    }}>
      {children}
    </SWRConfig>
  );
}


