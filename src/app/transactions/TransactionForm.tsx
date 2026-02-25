'use client';
import AssetInput from '../components/AssetInput';
import { isFiatCurrency } from '@/lib/assets';
import type { UseTransactionFormReturn } from './useTransactionForm';
import type { TransactionType } from './useTransactionForm';

interface TransactionFormProps {
  form: UseTransactionFormReturn;
}

export default function TransactionForm({ form }: TransactionFormProps) {
  const {
    formData,
    fieldErrors,
    isLoadingPrice,
    showMoreOptions,
    setShowMoreOptions,
    setField,
    setType,
    handleAssetSelection,
    detectedSwapMode,
    exchangeRateHint,
    currentHoldings,
  } = form;

  const fieldError = (field: string) => fieldErrors[field] ? (
    <small className="tf-field-error">{fieldErrors[field]}</small>
  ) : null;

  return (
    <div className="tf-form">
      {/* Transaction Type */}
      <div className="tf-group">
        <label className="tf-label">Transaction Type</label>
        <select
          value={formData.type}
          onChange={e => setType(e.target.value as TransactionType)}
          className="tf-select"
        >
          <option value="Deposit">Deposit (Fiat to Stablecoin)</option>
          <option value="Withdrawal">Withdrawal (Stablecoin to Fiat)</option>
          <option value="Swap">Swap (Crypto to Crypto)</option>
        </select>
      </div>

      {/* ─── SWAP FORM ─── */}
      {formData.type === 'Swap' && (
        <div className="tf-swap-container">
          {/* FROM side */}
          <div className="tf-swap-side">
            <div className="tf-swap-side-label">From</div>
            <div className="tf-group">
              <label className="tf-label">Asset</label>
              <AssetInput
                value={formData.fromAsset}
                onChange={(asset, symbol) => handleAssetSelection('from', asset, symbol)}
                placeholder="Select asset (e.g. BTC, USDC)"
                disabled={isLoadingPrice}
                filter={a => !isFiatCurrency(a.symbol)}
              />
              {fieldError('fromAsset')}
              {formData.fromAsset && currentHoldings[formData.fromAsset.toUpperCase()] !== undefined && (
                <small className="tf-balance-hint">
                  Balance: {currentHoldings[formData.fromAsset.toUpperCase()].toFixed(8)}
                </small>
              )}
            </div>
            <div className="tf-group">
              <label className="tf-label">Quantity</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={formData.fromQuantity}
                onChange={e => setField('fromQuantity', e.target.value)}
                className={`tf-input ${fieldErrors.fromQuantity ? 'tf-input-error' : ''}`}
              />
              {fieldError('fromQuantity')}
              {formData.fromAsset && formData.fromQuantity && (() => {
                const balance = currentHoldings[formData.fromAsset.toUpperCase()] || 0;
                const qty = Number(formData.fromQuantity);
                if (qty > balance && balance > 0) {
                  return <small className="tf-warning">Available: {balance.toFixed(8)}</small>;
                }
                return null;
              })()}
              {formData.fromPriceUsd && Number(formData.fromPriceUsd) > 0 && formData.fromQuantity && (
                <small className="tf-price-hint">
                  ~${(Number(formData.fromQuantity) * Number(formData.fromPriceUsd)).toFixed(2)} USD @ ${Number(formData.fromPriceUsd).toFixed(2)}/unit
                </small>
              )}
            </div>
          </div>

          {/* Arrow */}
          <div className="tf-swap-arrow">→</div>

          {/* TO side */}
          <div className="tf-swap-side">
            <div className="tf-swap-side-label">To</div>
            <div className="tf-group">
              <label className="tf-label">Asset</label>
              <AssetInput
                value={formData.toAsset}
                onChange={(asset, symbol) => handleAssetSelection('to', asset, symbol)}
                placeholder="Select asset (e.g. ETH, USDT)"
                disabled={isLoadingPrice}
                filter={a => !isFiatCurrency(a.symbol)}
              />
              {fieldError('toAsset')}
            </div>
            <div className="tf-group">
              <label className="tf-label">Quantity</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={formData.toQuantity}
                onChange={e => setField('toQuantity', e.target.value)}
                className={`tf-input ${fieldErrors.toQuantity ? 'tf-input-error' : ''}`}
              />
              {fieldError('toQuantity')}
              {formData.toPriceUsd && Number(formData.toPriceUsd) > 0 && formData.toQuantity && (
                <small className="tf-price-hint">
                  ~${(Number(formData.toQuantity) * Number(formData.toPriceUsd)).toFixed(2)} USD @ ${Number(formData.toPriceUsd).toFixed(2)}/unit
                </small>
              )}
            </div>
          </div>
        </div>
      )}

      {detectedSwapMode && (
        <div className="tf-detected-mode">
          {detectedSwapMode === 'buy' && 'Detected: Buy (Stablecoin to Crypto)'}
          {detectedSwapMode === 'sell' && 'Detected: Sell (Crypto to Stablecoin)'}
          {detectedSwapMode === 'swap' && 'Detected: Swap (Crypto to Crypto)'}
        </div>
      )}

      {/* ─── DEPOSIT FORM ─── */}
      {formData.type === 'Deposit' && (
        <>
          <div className="tf-section">
            <div className="tf-section-title">You deposited</div>
            <div className="tf-section-grid">
              <div className="tf-group">
                <label className="tf-label">Currency</label>
                <select
                  value={formData.fiatCurrency}
                  onChange={e => setField('fiatCurrency', e.target.value)}
                  className="tf-select"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
                {fieldError('fiatCurrency')}
              </div>
              <div className="tf-group">
                <label className="tf-label">Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={formData.fiatAmount}
                  onChange={e => setField('fiatAmount', e.target.value)}
                  className={`tf-input ${fieldErrors.fiatAmount ? 'tf-input-error' : ''}`}
                />
                {fieldError('fiatAmount')}
              </div>
            </div>
          </div>
          <div className="tf-section">
            <div className="tf-section-title">You received</div>
            <div className="tf-section-grid">
              <div className="tf-group">
                <label className="tf-label">Stablecoin</label>
                <AssetInput
                  value={formData.toAsset}
                  onChange={(asset, symbol) => handleAssetSelection('to', asset, symbol)}
                  placeholder="Select stablecoin (e.g. USDC)"
                  disabled={isLoadingPrice}
                  filter={a => a.category === 'stablecoin'}
                />
                {fieldError('toAsset')}
              </div>
              <div className="tf-group">
                <label className="tf-label">Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={formData.toQuantity}
                  onChange={e => setField('toQuantity', e.target.value)}
                  className={`tf-input ${fieldErrors.toQuantity ? 'tf-input-error' : ''}`}
                />
                {fieldError('toQuantity')}
              </div>
            </div>
            {exchangeRateHint && (
              <small className="tf-exchange-hint">{exchangeRateHint}</small>
            )}
          </div>
        </>
      )}

      {/* ─── WITHDRAWAL FORM ─── */}
      {formData.type === 'Withdrawal' && (
        <>
          <div className="tf-section">
            <div className="tf-section-title">You withdrew</div>
            <div className="tf-section-grid">
              <div className="tf-group">
                <label className="tf-label">Stablecoin</label>
                <AssetInput
                  value={formData.toAsset}
                  onChange={(asset, symbol) => handleAssetSelection('to', asset, symbol)}
                  placeholder="Select stablecoin (e.g. USDC)"
                  disabled={isLoadingPrice}
                  filter={a => a.category === 'stablecoin'}
                />
                {fieldError('toAsset')}
                {formData.toAsset && currentHoldings[formData.toAsset.toUpperCase()] !== undefined && (
                  <small className="tf-balance-hint">
                    Balance: {currentHoldings[formData.toAsset.toUpperCase()].toFixed(8)}
                  </small>
                )}
              </div>
              <div className="tf-group">
                <label className="tf-label">Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={formData.toQuantity}
                  onChange={e => setField('toQuantity', e.target.value)}
                  className={`tf-input ${fieldErrors.toQuantity ? 'tf-input-error' : ''}`}
                />
                {fieldError('toQuantity')}
              </div>
            </div>
          </div>
          <div className="tf-section">
            <div className="tf-section-title">You received</div>
            <div className="tf-section-grid">
              <div className="tf-group">
                <label className="tf-label">Currency</label>
                <select
                  value={formData.fiatCurrency}
                  onChange={e => setField('fiatCurrency', e.target.value)}
                  className="tf-select"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
                {fieldError('fiatCurrency')}
              </div>
              <div className="tf-group">
                <label className="tf-label">Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={formData.fiatAmount}
                  onChange={e => setField('fiatAmount', e.target.value)}
                  className={`tf-input ${fieldErrors.fiatAmount ? 'tf-input-error' : ''}`}
                />
                {fieldError('fiatAmount')}
              </div>
            </div>
            {exchangeRateHint && (
              <small className="tf-exchange-hint">{exchangeRateHint}</small>
            )}
          </div>
        </>
      )}

      {/* ─── DATE/TIME ─── */}
      <div className="tf-group">
        <label className="tf-label">Date & Time</label>
        <input
          type="datetime-local"
          value={formData.datetime}
          onChange={e => setField('datetime', e.target.value)}
          className={`tf-input ${fieldErrors.datetime ? 'tf-input-error' : ''}`}
        />
        {fieldError('datetime')}
      </div>

      {/* ─── MORE OPTIONS (Fees + Notes) ─── */}
      {!showMoreOptions ? (
        <button
          type="button"
          className="tf-more-toggle"
          onClick={() => setShowMoreOptions(true)}
        >
          + Fees & Notes
        </button>
      ) : (
        <div className="tf-section">
          <div className="tf-section-title">
            Additional Details
            <button
              type="button"
              className="tf-section-collapse"
              onClick={() => setShowMoreOptions(false)}
            >
              Hide
            </button>
          </div>
          <div className="tf-section-grid">
            <div className="tf-group">
              <label className="tf-label">Fees (USD)</label>
              <input
                type="number"
                step="any"
                placeholder="0.00"
                value={formData.feesUsd}
                onChange={e => setField('feesUsd', e.target.value)}
                className="tf-input"
              />
            </div>
            <div className="tf-group">
              <label className="tf-label">Notes</label>
              <input
                placeholder="Optional notes"
                value={formData.notes || ''}
                onChange={e => setField('notes', e.target.value)}
                className="tf-input"
              />
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .tf-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .tf-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tf-label {
          font-weight: 600;
          font-size: 13px;
          color: var(--text);
        }

        .tf-input, .tf-select {
          background: var(--surface);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 14px;
          transition: border-color 0.2s;
        }

        .tf-input:focus, .tf-select:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.15);
        }

        .tf-input-error {
          border-color: #dc2626 !important;
        }

        .tf-field-error {
          color: #dc2626;
          font-size: 12px;
          font-weight: 500;
        }

        .tf-warning {
          color: #dc2626;
          font-size: 11px;
          font-weight: 600;
        }

        .tf-balance-hint {
          color: var(--muted);
          font-size: 11px;
        }

        .tf-price-hint {
          color: var(--primary);
          font-size: 11px;
        }

        .tf-exchange-hint {
          color: var(--primary);
          font-size: 12px;
          font-style: italic;
          margin-top: 4px;
        }

        .tf-detected-mode {
          font-size: 12px;
          color: var(--muted);
          text-align: center;
          padding: 4px 0;
        }

        /* Sections */
        .tf-section {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .tf-section-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .tf-section-collapse {
          font-size: 11px;
          color: var(--muted);
          background: none;
          border: none;
          cursor: pointer;
          text-transform: none;
          letter-spacing: 0;
          font-weight: 400;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .tf-section-collapse:hover {
          background: var(--border);
        }

        .tf-section-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        /* Swap layout */
        .tf-swap-container {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          gap: 16px;
          align-items: start;
          padding: 16px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border);
          border-radius: 12px;
        }

        .tf-swap-side {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .tf-swap-side-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .tf-swap-arrow {
          font-size: 28px;
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          padding-top: 40px;
        }

        /* More options toggle */
        .tf-more-toggle {
          background: none;
          border: 1px dashed var(--border);
          border-radius: 8px;
          padding: 8px 16px;
          color: var(--muted);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          text-align: center;
        }

        .tf-more-toggle:hover {
          border-color: var(--primary);
          color: var(--primary);
        }

        @media (max-width: 768px) {
          .tf-swap-container {
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .tf-swap-arrow {
            transform: rotate(90deg);
            padding: 4px 0;
            font-size: 24px;
          }

          .tf-section-grid {
            grid-template-columns: 1fr;
          }

          .tf-input, .tf-select {
            padding: 12px;
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  );
}
