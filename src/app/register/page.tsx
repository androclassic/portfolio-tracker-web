'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [password2, setPassword2] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(''); setInfo('');
    setLoading(true);
    
    if (password !== password2) { 
      setError('Passwords do not match'); 
      setLoading(false);
      return; 
    }
    
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      setLoading(false);
      return;
    }
    
    try {
      const res = await fetch('/api/auth/register', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ email, password }) 
      });
              const j = await res.json().catch(()=>({}));
              if (res.ok) {
                if (j.requiresVerification) {
                  setInfo('Account created successfully! Please check your email for a verification link to complete your registration.');
                  // Don't redirect automatically - user needs to verify email first
                } else {
                  setInfo('Account created successfully! Redirecting to login...');
                  setTimeout(()=> router.replace('/login'), 2000);
                }
              } else {
                setError(j?.error || 'Registration failed');
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
      await signIn(provider, { callbackUrl: '/overview' });
    } catch (error) {
      setError('OAuth sign-in failed. Please try again.');
      setLoading(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Create account</h1>
      <p className="subtitle">Start tracking your portfolio in minutes.</p>
      
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
        
        <button
          type="button"
          onClick={() => handleOAuthSignIn('facebook')}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            backgroundColor: '#1877F2',
            color: 'white',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: '0.875rem',
            fontWeight: '500'
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
          Continue with Facebook
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
          required 
          disabled={loading} 
          style={{ opacity: loading? .6 : 1 }} 
        />
        <input 
          type="password" 
          placeholder="Password" 
          value={password} 
          onChange={e=>setPassword(e.target.value)} 
          required 
          disabled={loading} 
          style={{ opacity: loading? .6 : 1 }} 
        />
        <input 
          type="password" 
          placeholder="Confirm password" 
          value={password2} 
          onChange={e=>setPassword2(e.target.value)} 
          required 
          disabled={loading} 
          style={{ opacity: loading? .6 : 1 }} 
        />
        {error && (
          <div style={{ background:'var(--danger-50)', border:'1px solid color-mix(in oklab, var(--danger) 30%, transparent)', color:'var(--danger)', borderRadius:8, padding:'10px 12px', fontSize:14 }}>
            {error}
          </div>
        )}
        {info && (
          <div style={{ background:'var(--success-50)', border:'1px solid color-mix(in oklab, var(--success) 30%, transparent)', color:'var(--success)', borderRadius:8, padding:'10px 12px', fontSize:14 }}>
            {info}
          </div>
        )}
        <div className="actions" style={{ display:'flex', justifyContent:'flex-end', alignItems:'center', gap:8 }}>
          <a href="/login" className="btn btn-secondary" style={{ opacity: loading ? 0.6 : 1 }}>Sign in</a>
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ minWidth: 120 }}>
            {loading ? (<><span className="loading-spinner" /> Creating...</>) : 'Register'}
          </button>
        </div>
      </form>
    </main>
  );
}


