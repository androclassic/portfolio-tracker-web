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
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ color: '#16a34a', marginBottom: '1rem' }}>Login Successful!</h2>
          <p style={{ color: '#6b7280' }}>Redirecting to your dashboard...</p>
          <div style={{ 
            width: '100%', 
            height: '4px', 
            backgroundColor: '#e5e7eb', 
            borderRadius: '2px', 
            marginTop: '1rem',
            overflow: 'hidden'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              backgroundColor: '#16a34a',
              animation: 'loading 0.8s ease-in-out'
            }}></div>
          </div>
        </div>
        <style jsx>{`
          @keyframes loading {
            from { width: 0%; }
            to { width: 100%; }
          }
        `}</style>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Sign in</h1>
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
            style={{ 
              opacity: loading ? 0.8 : 1,
              minWidth: '100px',
              position: 'relative'
            }}
          >
            {loading ? (
              <>
                <span style={{ opacity: 0 }}>Login</span>
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '16px',
                  height: '16px',
                  border: '2px solid #ffffff',
                  borderTop: '2px solid transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
              </>
            ) : (
              'Login'
            )}
          </button>
        </div>
      </form>
      
      <style jsx>{`
        @keyframes spin {
          0% { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>
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


