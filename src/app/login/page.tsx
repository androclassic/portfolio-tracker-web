'use client';
import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();
  const rawRedirect = sp.get('redirect') || '/overview';
  const redirect = (rawRedirect.startsWith('/api') || rawRedirect === '/login' || rawRedirect === '/register') ? '/overview' : rawRedirect;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    
    setError('');
    setLoading(true);
    
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      
      if (result?.error) {
        if (result.error.includes('verify your email')) {
          setError('Please verify your email before signing in');
          setShowResendVerification(true);
        } else {
          setError('Invalid email or password');
          setShowResendVerification(false);
        }
      } else if (result?.ok) {
        setSuccess(true);
        setError('');
        
        // Notify the header that auth state changed
        window.dispatchEvent(new CustomEvent('auth-changed'));
        
        // Redirect after success
        setTimeout(() => {
          router.push(redirect);
        }, 800);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuthSignIn(provider: string) {
    setLoading(true);
    setError('');
    
    try {
      await signIn(provider, { callbackUrl: redirect });
    } catch {
      setError('OAuth sign-in failed. Please try again.');
      setLoading(false);
    }
  }

  async function handleMagicLink() {
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

      // User exists, send magic link
      const result = await signIn('email', { 
        email,
        redirect: false,
        callbackUrl: redirect
      });

      if (result?.error) {
        setError('Failed to send magic link');
      } else {
        setSuccess(true);
        setError('');
      }
    } catch {
      setError('Failed to send magic link');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
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
        callbackUrl: redirect
      });

      if (result?.error) {
        setError('Failed to resend verification email');
      } else {
        setSuccess(true);
        setError('');
        setShowResendVerification(false);
      }
    } catch {
      setError('Failed to resend verification email');
    } finally {
      setLoading(false);
    }
  }

  // If login is successful or magic link sent, show success state
  if (success) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '2.25rem', marginBottom: '0.75rem' }}>📧</div>
          <h2 style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>Check Your Email!</h2>
          <p className="muted">We&apos;ve sent you a magic link to sign in. Click the link in your email to continue.</p>
          <div style={{ marginTop: '1.5rem', padding: '1rem', backgroundColor: 'var(--surface)', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: 0 }}>
              💡 Tip: Check your spam folder if you don&apos;t see the email within a few minutes.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <p className="subtitle">Welcome back. Please enter your credentials.</p>
      
      {/* OAuth Buttons */}
      <div className="card" style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => handleOAuthSignIn('google')}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            backgroundColor: 'white',
            color: '#333',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: '0.875rem',
            fontWeight: '500'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>
      </div>

      <div style={{ textAlign: 'center', margin: '1rem 0', color: 'var(--muted)' }}>
        or
      </div>
      
      <form className="card" onSubmit={onSubmit} style={{ display:'grid', gap:10 }}>
        <input 
          type="email"
          placeholder="Email" 
          value={email} 
          onChange={e=>setEmail(e.target.value)} 
          disabled={loading}
          required 
          style={{ opacity: loading ? 0.6 : 1 }}
        />
        <input 
          type="password" 
          placeholder="Password" 
          value={password} 
          onChange={e=>setPassword(e.target.value)} 
          disabled={loading}
          required 
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
            {showResendVerification && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #fecaca' }}>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '0.875rem',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1
                  }}
                >
                  📧 Resend Verification Email
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center', margin: '1rem 0', color: 'var(--muted)' }}>
          or
        </div>

        <button
          type="button"
          onClick={handleMagicLink}
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            backgroundColor: 'var(--surface)',
            color: 'var(--text)',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: '0.875rem',
            fontWeight: '500',
            marginBottom: '1rem'
          }}
        >
          📧 Send Magic Link to Email
        </button>
        
        <div className="actions" style={{ display:'flex', justifyContent:'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <a href="/register" className="btn btn-secondary" style={{ opacity: loading ? 0.6 : 1 }}>
              Create account
            </a>
            <a href="/resend-verification" style={{ fontSize: '0.875rem', color: 'var(--muted)', textDecoration: 'none', opacity: loading ? 0.6 : 1 }}>
              Resend verification email
            </a>
          </div>
          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={loading}
            style={{ minWidth: '110px' }}
          >
            {loading ? (
              <>
                <span className="loading-spinner" />
                Loading
              </>
            ) : (
              'Login'
            )}
          </button>
        </div>
      </form>
    </main>
  );
}

function LoginPageContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const rawRedirect = sp.get('redirect') || '/overview';
  const redirect = (rawRedirect?.startsWith('/api') || rawRedirect === '/login' || rawRedirect === '/register') ? '/overview' : rawRedirect;

  useEffect(() => {
    if (status === 'loading') return;
    if (session) {
      // If already authenticated, immediately leave the login page.
      router.replace(redirect);
    }
  }, [session, status, router, redirect]);

  // While checking session or when authenticated (to avoid flash of the form), show a minimal loader
  if (status === 'loading' || session) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <h1>Sign in</h1>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          Loading...
        </div>
      </main>
    );
  }

  return <LoginForm />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="container" style={{ maxWidth: 420 }}>
        <h1>Sign in</h1>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          Loading...
        </div>
      </main>
    }>
      <LoginPageContent />
    </Suspense>
  );
}


