'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly check, server enforces once/day execution.

export default function AutoSyncRunner() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return;

    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      try {
        await fetch('/api/integrations/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto: true }),
        });
      } catch {
        // Best-effort background sync; ignore network/runtime errors.
      }
    };

    run();
    const timer = window.setInterval(run, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [status]);

  return null;
}
