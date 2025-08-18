'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // const router = useRouter(); // Not needed since we use window.location.href
  const sp = useSearchParams();
  const rawRedirect = sp.get('redirect') || '/dashboard';
  const redirect = (rawRedirect.startsWith('/api') || rawRedirect === '/login' || rawRedirect === '/register') ? '/dashboard' : rawRedirect;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return; // Prevent double submission
    
    setError('');
    setLoading(true);
    
    try {
      // Hash password on client-side using SHA-256 (deterministic)
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      const res = await fetch('/api/auth/login', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ username, passwordHash }) 
      });
      
      if (res.ok) {
        setSuccess(true);
        setError('');
        
        // Notify the header that auth state changed
        window.dispatchEvent(new CustomEvent('auth-changed'));
        
        // Show success message briefly, then redirect with hard refresh
        setTimeout(() => {
          // Use hard navigation to ensure fresh data load
          window.location.href = redirect;
        }, 800);
      } else {
        let msg = 'Login failed';
        try {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.json();
            msg = j?.error || msg;
          } else {
            msg = await res.text();
          }
        } catch {}
        setError(msg);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // If login is successful, show success state
  if (success) {
    return (
      <main className="container" style={{ maxWidth: 420 }}>
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <div style={{ fontSize: '2.25rem', marginBottom: '0.75rem' }}>✅</div>
          <h2 style={{ color: 'var(--success)', marginBottom: '0.5rem' }}>Login Successful!</h2>
          <p className="muted">Redirecting to your dashboard...</p>
          <div style={{ marginTop: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="loading-spinner" />
            <span className="muted">Loading</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
      <p className="subtitle">Welcome back. Please enter your credentials.</p>
      <form className="card" onSubmit={onSubmit} style={{ display:'grid', gap:10 }}>
        <input 
          placeholder="Username" 
          value={username} 
          onChange={e=>setUsername(e.target.value)} 
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
          </div>
        )}
        
        <div className="actions" style={{ display:'flex', justifyContent:'space-between', alignItems: 'center' }}>
          <a href="/register" className="btn btn-secondary" style={{ opacity: loading ? 0.6 : 1 }}>
            Create account
          </a>
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
      <LoginForm />
    </Suspense>
  );
}


