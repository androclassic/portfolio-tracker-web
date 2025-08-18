'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
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
    if (password !== password2) { setError('Passwords do not match'); return; }
    
    // Hash password on client-side using SHA-256 (deterministic)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    try {
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, passwordHash }) });
      const j = await res.json().catch(()=>({}));
      if (res.ok) {
        setInfo('Account created. Check email for verification link.');
        if (j.verifyToken) setInfo(`Account created. Verification token: ${j.verifyToken}`);
        setTimeout(()=> router.replace('/login'), 2000);
      } else {
        setError(j?.error || 'Registration failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Create account</h1>
      <p className="subtitle">Start tracking your portfolio in minutes.</p>
      <form className="card" onSubmit={onSubmit} style={{ display:'grid', gap:10 }}>
        <input placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} required disabled={loading} style={{ opacity: loading? .6 : 1 }} />
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required disabled={loading} style={{ opacity: loading? .6 : 1 }} />
        <input type="password" placeholder="Confirm password" value={password2} onChange={e=>setPassword2(e.target.value)} required disabled={loading} style={{ opacity: loading? .6 : 1 }} />
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


