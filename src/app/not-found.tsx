import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: 'var(--space-lg)',
    }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-2xl) var(--space-xl)',
        textAlign: 'center' as const,
        maxWidth: 440,
        width: '100%',
      }}>
        <div style={{
          fontSize: '3rem',
          marginBottom: 'var(--space-lg)',
        }}>
          404
        </div>
        <h2 style={{
          color: 'var(--text)',
          fontSize: 'var(--text-xl)',
          margin: '0 0 var(--space-sm)',
        }}>
          Page not found
        </h2>
        <p style={{
          color: 'var(--muted)',
          fontSize: 'var(--text-sm)',
          margin: '0 0 var(--space-lg)',
          lineHeight: 1.5,
        }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-sm) var(--space-lg)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            textDecoration: 'none',
            transition: 'background 0.15s',
          }}
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
