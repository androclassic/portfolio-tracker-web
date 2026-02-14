'use client';

import { useEffect } from 'react';

export default function CashDashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Cash dashboard error:', error);
  }, [error]);

  return (
    <div className="error-boundary">
      <div className="error-card">
        <div className="error-icon">!</div>
        <h2>Cash dashboard failed to load</h2>
        <p>
          There was a problem loading the cash flow analysis. This may be caused
          by a temporary data or calculation issue.
        </p>
        <div className="error-details">{error.message}</div>
        <button onClick={reset}>Reload dashboard</button>
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
          max-width: 480px;
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
          margin: 0 0 var(--space-md);
          line-height: 1.5;
        }
        .error-details {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: var(--space-sm) var(--space-md);
          font-size: var(--text-xs);
          color: var(--muted);
          margin-bottom: var(--space-lg);
          word-break: break-word;
          font-family: monospace;
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
