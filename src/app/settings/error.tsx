'use client';

import { useEffect } from 'react';

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Settings error:', error);
  }, [error]);

  return (
    <div className="error-boundary">
      <div className="error-card">
        <div className="error-icon">!</div>
        <h2>Settings failed to load</h2>
        <p>{error.message || 'An unexpected error occurred while loading your settings.'}</p>
        <button onClick={reset}>Try again</button>
      </div>

      <style jsx>{`
        .error-boundary {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          padding: var(--space-lg);
        }
        .error-card {
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: var(--space-2xl) var(--space-xl);
          text-align: center;
          max-width: 440px;
          width: 100%;
        }
        .error-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--danger-50);
          color: var(--danger);
          font-size: var(--text-xl);
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-lg);
        }
        h2 {
          color: var(--text);
          font-size: var(--text-xl);
          margin: 0 0 var(--space-sm);
        }
        p {
          color: var(--muted);
          font-size: var(--text-sm);
          margin: 0 0 var(--space-lg);
          line-height: 1.5;
          word-break: break-word;
        }
        button {
          background: var(--primary);
          color: #fff;
          border: none;
          border-radius: var(--radius-sm);
          padding: var(--space-sm) var(--space-lg);
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
        }
        button:hover {
          background: var(--primary-600);
        }
      `}</style>
    </div>
  );
}
