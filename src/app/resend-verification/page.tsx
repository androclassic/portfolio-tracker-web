'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

export default function ResendVerificationPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // First check if user exists
      const checkResponse = await fetch('/api/auth/check-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const checkResult = await checkResponse.json();

      if (!checkResult.exists) {
        setError('No account found with this email address. Please register first.');
        setLoading(false);
        return;
      }

      // Check if user is already verified
      if (checkResult.user.emailVerified) {
        setError('This email is already verified. You can login with your password.');
        setLoading(false);
        return;
      }

      // User exists and needs verification, send verification email
      const result = await signIn('email', { 
        email,
        redirect: false,
        callbackUrl: '/overview'
      });

      if (result?.error) {
        setError('Failed to send verification email. Please try again.');
      } else {
        setSuccess(true);
        setError('');
      }
    } catch {
      setError('Failed to send verification email. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '2.25rem', marginBottom: '0.75rem' }}>📧</div>
          <h2 style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>Verification Email Sent!</h2>
          <p className="muted">We&apos;ve sent a new verification link to your email. Click the link to verify your account and sign in.</p>
          <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--surface)', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: 0 }}>
              💡 Tip: Check your spam folder if you don&apos;t see the email within a few minutes.
            </p>
          </div>
          <div style={{ marginTop: '1.5rem' }}>
            <Link href="/login" className="btn btn-primary">
              Back to Login
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Resend Verification Email</h1>
      <p className="subtitle">
        Didn&apos;t receive the verification email? Enter your email address below to get a new one.
      </p>

      <form className="card" onSubmit={handleResend} style={{ display: 'grid', gap: '1rem' }}>
        <input
          type="email"
          placeholder="Enter your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
          style={{ opacity: loading ? 0.6 : 1 }}
        />

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

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
          style={{ minWidth: '200px' }}
        >
          {loading ? (
            <>
              <span className="loading-spinner" />
              Sending...
            </>
          ) : (
            '📧 Send Verification Email'
          )}
        </button>

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link href="/login" className="btn btn-secondary">
            Back to Login
          </Link>
        </div>
      </form>
    </main>
  );
}
