'use client';
import { useState } from 'react';
import { useTransactionForm } from './useTransactionForm';
import TransactionForm from './TransactionForm';
import { buildTransactionPayload, parseApiErrors } from './buildTransactionPayload';
import type { Transaction as Tx } from '@/lib/types';

interface TransactionModalProps {
  mode: 'add' | 'edit';
  editingTransaction?: Tx | null;
  currentHoldings: Record<string, number>;
  portfolioId: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export default function TransactionModal({
  mode,
  editingTransaction,
  currentHoldings,
  portfolioId,
  onClose,
  onSaved,
}: TransactionModalProps) {
  const [isSaving, setIsSaving] = useState(false);

  const form = useTransactionForm({
    editingTransaction: mode === 'edit' ? editingTransaction : null,
    currentHoldings,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.validate()) return;

    setIsSaving(true);
    form.setGlobalErrors([]);

    try {
      const payload = await buildTransactionPayload(
        form.formData,
        portfolioId,
        mode === 'edit' && editingTransaction ? editingTransaction.id : undefined
      );

      const method = mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch('/api/transactions', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        await res.json();
        await onSaved();
        onClose();

        // Notify other components
        window.dispatchEvent(new CustomEvent('transactions-changed'));
      } else {
        const errorData = await res.json();
        form.setGlobalErrors(parseApiErrors(errorData));
      }
    } catch (error) {
      console.error('Error saving transaction:', error);
      form.setGlobalErrors(['Network error. Please try again.']);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal transaction-modal" role="dialog" aria-modal="true">
        <div className="card-header" style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
          <div className="card-title">
            <h3 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>
              {mode === 'edit' ? 'Edit Transaction' : 'Add Transaction'}
            </h3>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            style={{ fontSize: '1.2rem', padding: '4px 8px' }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {form.globalErrors.length > 0 && (
          <div className="tm-errors">
            {form.globalErrors.map((error, i) => (
              <div key={i} className="tm-error">{error}</div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <TransactionForm form={form} />

          <div className="tm-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={form.isLoadingPrice || isSaving}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {isSaving ? (
                <>
                  <span className="loading-spinner"></span>
                  Saving...
                </>
              ) : form.isLoadingPrice ? (
                <>
                  <span className="loading-spinner"></span>
                  Loading...
                </>
              ) : (
                'Save Transaction'
              )}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .transaction-modal {
          max-width: 700px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
        }

        .tm-errors {
          background: #fee2e2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 16px;
        }

        .tm-error {
          color: #dc2626;
          font-size: 14px;
          margin-bottom: 4px;
        }

        .tm-error:last-child {
          margin-bottom: 0;
        }

        .tm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }

        @media (max-width: 768px) {
          .tm-actions {
            flex-direction: column;
          }

          .tm-actions button {
            width: 100%;
            justify-content: center;
          }
        }
      `}</style>
    </div>
  );
}
