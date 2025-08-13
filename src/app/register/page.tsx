'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [password2, setPassword2] = useState('');
  const [info, setInfo] = useState('');
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setInfo('');
    if (password !== password2) { setError('Passwords do not match'); return; }
    
    // Hash password on client-side using SHA-256 (deterministic)
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, passwordHash }) });
    const j = await res.json().catch(()=>({}));
    if (res.ok) {
      setInfo('Account created. Check email for verification link.');
      // For demo, show token in UI
      if (j.verifyToken) setInfo(`Account created. Verification token: ${j.verifyToken}`);
      setTimeout(()=> router.replace('/login'), 2000);
    } else {
      setError(j?.error || 'Registration failed');
    }
  }

  return (
    <main className="container" style={{ maxWidth: 420 }}>
      <h1>Create account</h1>
      <form className="card" onSubmit={onSubmit} style={{ display:'grid', gap:10 }}>
        <input placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required />
        <input type="password" placeholder="Confirm password" value={password2} onChange={e=>setPassword2(e.target.value)} required />
        {error && <div style={{ color:'#dc2626' }}>{error}</div>}
        {info && <div style={{ color:'#16a34a' }}>{info}</div>}
        <div className="actions" style={{ display:'flex', justifyContent:'flex-end' }}>
          <button type="submit" className="btn btn-primary">Register</button>
        </div>
      </form>
    </main>
  );
}


