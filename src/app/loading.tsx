export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      padding: 'var(--space-lg)',
    }}>
      <div style={{
        textAlign: 'center' as const,
      }}>
        <div
          style={{
            width: 40,
            height: 40,
            border: '3px solid var(--border)',
            borderTopColor: 'var(--primary)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto var(--space-lg)',
          }}
        />
        <p style={{
          color: 'var(--muted)',
          fontSize: 'var(--text-sm)',
          margin: 0,
        }}>
          Loading…
        </p>
      </div>
    </div>
  );
}
