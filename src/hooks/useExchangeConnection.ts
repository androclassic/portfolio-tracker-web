'use client';

import { useState, useEffect, useCallback } from 'react';

interface SavedConnection {
  found: boolean;
  apiKey?: string;
  apiSecret?: string;
  label?: string;
}

export function useExchangeConnection(exchange: string) {
  const [savedKey, setSavedKey] = useState('');
  const [savedSecret, setSavedSecret] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/integrations/connections/credentials?exchange=${exchange}`)
      .then(r => r.json())
      .then((data: SavedConnection) => {
        if (data.found && data.apiKey && data.apiSecret) {
          setSavedKey(data.apiKey);
          setSavedSecret(data.apiSecret);
          setHasSaved(true);
        }
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, [exchange]);

  const save = useCallback(async (apiKey: string, apiSecret: string) => {
    await fetch('/api/integrations/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchange, apiKey, apiSecret }),
    });
    setHasSaved(true);
  }, [exchange]);

  const remove = useCallback(async () => {
    await fetch(`/api/integrations/connections?exchange=${exchange}`, {
      method: 'DELETE',
    });
    setSavedKey('');
    setSavedSecret('');
    setHasSaved(false);
  }, [exchange]);

  return { savedKey, savedSecret, isLoaded, hasSaved, save, remove };
}
