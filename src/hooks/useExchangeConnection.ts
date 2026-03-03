'use client';

import { useState, useEffect, useCallback } from 'react';

interface SavedConnection {
  found: boolean;
  apiKeyPreview?: string;
  hasStoredSecret?: boolean;
  label?: string;
}

export function useExchangeConnection(exchange: string) {
  const [savedKeyPreview, setSavedKeyPreview] = useState('');
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/integrations/connections/credentials?exchange=${exchange}`)
      .then(r => r.json())
      .then((data: SavedConnection) => {
        if (data.found) {
          setSavedKeyPreview(data.apiKeyPreview || '****');
          setHasSaved(true);
        }
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, [exchange]);

  const save = useCallback(async (apiKey: string, apiSecret: string) => {
    const response = await fetch('/api/integrations/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exchange, apiKey, apiSecret }),
    });
    const payload = await response.json().catch(() => ({} as { apiKeyPreview?: string }));
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to save credentials');
    }
    setSavedKeyPreview(payload?.apiKeyPreview || maskKey(apiKey));
    setHasSaved(true);
  }, [exchange]);

  const remove = useCallback(async () => {
    await fetch(`/api/integrations/connections?exchange=${exchange}`, {
      method: 'DELETE',
    });
    setSavedKeyPreview('');
    setHasSaved(false);
  }, [exchange]);

  return { savedKeyPreview, isLoaded, hasSaved, save, remove };
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}
