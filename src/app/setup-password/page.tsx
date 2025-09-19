'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SetupPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    
    if (!session) {
      router.replace('/login');
    }
  }, [session, status, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setError('');
    
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess(true);
        setTimeout(() => {
          router.push('/overview');
        }, 2000);
      } else {
        setError(result.error || 'Failed to set password');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading' || !session) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ color: 'var(--muted)' }}>Loading...</div>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '2.25rem', marginBottom: '0.75rem' }}>✅</div>
          <h2 style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>Password Set Successfully!</h2>
          <p className="muted">You can now login with either your email/password or magic links.</p>
          <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>
            Redirecting to your dashboard...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Set Up Your Password</h1>
      <p className="subtitle">
        You logged in with a magic link. To enable password login, please set up a password for your account.
      </p>

      <form className="card" onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div>
          <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
            New Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={loading}
            required
            style={{ opacity: loading ? 0.6 : 1 }}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            placeholder="Confirm your password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            disabled={loading}
            required
            style={{ opacity: loading ? 0.6 : 1 }}
          />
        </div>

        {error && (
          <div style={{
            color: '#dc2626',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            padding: '0.75rem',
            fontSize: '0.875rem'
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
          <button
            type="button"
            onClick={() => router.push('/overview')}
            className="btn btn-ghost"
            disabled={loading}
            style={{ opacity: loading ? 0.6 : 1 }}
          >
            Skip for now
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ minWidth: '120px' }}
          >
            {loading ? (
              <>
                <span className="loading-spinner" />
                Setting...
              </>
            ) : (
              'Set Password'
            )}
          </button>
        </div>
      </form>

      <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'var(--surface)', borderRadius: '6px', border: '1px solid var(--border)' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: 0 }}>
          💡 <strong>Optional:</strong> You can continue using magic links only if you prefer. Setting a password allows you to login faster without checking your email.
        </p>
      </div>
    </main>
  );
}
