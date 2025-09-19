'use client';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Page() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return; // Still loading session
    
    if (session) {
      // User is authenticated, redirect to overview
      router.replace('/overview');
    } else {
      // User is not authenticated, redirect to login
      router.replace('/login');
    }
  }, [session, status, router]);

  // Show loading while determining auth status
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      height: '100vh',
      flexDirection: 'column',
      gap: '1rem'
    }}>
      <div style={{ fontSize: '2rem' }}>Portfolio Tracker</div>
      <div style={{ color: 'var(--muted)' }}>Loading...</div>
    </div>
  );
}
