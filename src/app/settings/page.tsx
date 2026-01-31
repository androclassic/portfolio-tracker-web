'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  key?: string; // Only present on creation
  lastUsedAt: string | null;
  createdAt: string;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user needs to set up password
  useEffect(() => {
    if (session?.needsPasswordSetup) {
      router.push('/setup-password');
    }
  }, [session, router]);

  // Fetch API keys
  useEffect(() => {
    fetchApiKeys();
  }, []);

  async function fetchApiKeys() {
    try {
      const res = await fetch('/api/account/api-keys');
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.apiKeys || []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/account/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName || 'Ticker API Key' }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create API key');
        return;
      }

      // Show the new key (only time it's visible)
      setNewlyCreatedKey(data.apiKey.key);
      setNewKeyName('');
      await fetchApiKeys();
    } catch (err) {
      setError('Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(`/api/account/api-keys?id=${keyId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchApiKeys();
      }
    } catch (err) {
      console.error('Failed to revoke key:', err);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <AuthGuard redirectTo="/settings">
      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
        <h1 style={{ marginBottom: '0.5rem' }}>Settings</h1>
        <p style={{ color: 'var(--muted)', marginBottom: '2rem' }}>
          Manage your account settings and API access
        </p>

        {/* Account Info Section */}
        <section className="card" style={{ marginBottom: '2rem' }}>
          <div className="card-header">
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Account</h2>
          </div>
          <div style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {session?.user?.image && (
                <img
                  src={session.user.image}
                  alt="Profile"
                  style={{ width: 48, height: 48, borderRadius: '50%' }}
                />
              )}
              <div>
                <div style={{ fontWeight: 'bold' }}>{session?.user?.name || 'User'}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                  {session?.user?.email}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  User ID: <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                    {session?.user?.id}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* API Keys Section */}
        <section className="card">
          <div className="card-header">
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>API Keys</h2>
          </div>
          <div style={{ padding: '1rem' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
              API keys allow external applications (like e-ink tickers) to access your portfolio data.
              Keys are shown only once when created - save them securely!
            </p>

            {/* New Key Created Alert */}
            {newlyCreatedKey && (
              <div style={{
                background: '#16a34a20',
                border: '1px solid #16a34a',
                borderRadius: 8,
                padding: '1rem',
                marginBottom: '1rem',
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#16a34a' }}>
                  API Key Created Successfully!
                </div>
                <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                  Copy this key now. It won&apos;t be shown again:
                </p>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'var(--bg-secondary)',
                  padding: '0.75rem',
                  borderRadius: 4,
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  wordBreak: 'break-all',
                }}>
                  <code style={{ flex: 1 }}>{newlyCreatedKey}</code>
                  <button
                    onClick={() => copyToClipboard(newlyCreatedKey)}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                  >
                    {copySuccess ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <button
                  onClick={() => setNewlyCreatedKey(null)}
                  style={{
                    marginTop: '0.75rem',
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Create New Key Form */}
            <form onSubmit={handleCreateKey} style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                    Key Name (optional)
                  </label>
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., E-Ink Ticker"
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isCreating}
                  style={{ padding: '0.5rem 1rem' }}
                >
                  {isCreating ? 'Creating...' : 'Create API Key'}
                </button>
              </div>
              {error && (
                <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  {error}
                </div>
              )}
            </form>

            {/* API Keys List */}
            {isLoading ? (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
                Loading API keys...
              </div>
            ) : apiKeys.length === 0 ? (
              <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '2rem' }}>
                No API keys yet. Create one to get started.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      background: 'var(--bg-secondary)',
                      borderRadius: 8,
                      gap: '1rem',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{key.name}</div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', fontFamily: 'monospace' }}>
                        {key.keyPrefix}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
                        Created: {formatDate(key.createdAt)} | Last used: {formatDate(key.lastUsedAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeKey(key.id)}
                      className="btn btn-secondary"
                      style={{
                        padding: '0.25rem 0.75rem',
                        fontSize: '0.8rem',
                        color: '#dc2626',
                        borderColor: '#dc2626',
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Usage Instructions */}
            <details style={{ marginTop: '1.5rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 500, color: 'var(--muted)' }}>
                How to use your API key
              </summary>
              <div style={{
                marginTop: '0.75rem',
                padding: '1rem',
                background: 'var(--bg-secondary)',
                borderRadius: 8,
                fontSize: '0.9rem',
              }}>
                <p style={{ marginBottom: '0.75rem' }}>
                  Use your API key to fetch portfolio data from external devices:
                </p>
                <pre style={{
                  background: 'var(--bg-primary)',
                  padding: '0.75rem',
                  borderRadius: 4,
                  overflow: 'auto',
                  fontSize: '0.8rem',
                }}>
{`curl -H "X-API-Key: YOUR_API_KEY" \\
  "${typeof window !== 'undefined' ? window.location.origin : ''}/api/ticker/portfolio?portfolioId=1"`}
                </pre>
                <p style={{ marginTop: '0.75rem', color: 'var(--muted)' }}>
                  The API returns your holdings, allocation, and P&L data in JSON format.
                </p>
              </div>
            </details>
          </div>
        </section>
      </main>
    </AuthGuard>
  );
}
