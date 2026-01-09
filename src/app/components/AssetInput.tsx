'use client';
import { useState, useEffect, useRef } from 'react';
import { searchAssets, SupportedAsset, getAssetColor } from '../../lib/assets';
import CryptoIcon from './CryptoIcon';

interface AssetInputProps {
  value: string;
  onChange: (asset: SupportedAsset | null, symbol: string) => void;
  placeholder?: string;
  disabled?: boolean;
  filter?: (asset: SupportedAsset) => boolean;
}

export default function AssetInput({ value, onChange, placeholder = "Search crypto...", disabled = false, filter }: AssetInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SupportedAsset[]>([]);
  const [inputValue, setInputValue] = useState(value);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const isTypingRef = useRef(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Only sync with value prop when not actively typing (e.g., when value changes externally)
  useEffect(() => {
    if (!isTypingRef.current) {
      setInputValue(value);
    }
  }, [value]);

  useEffect(() => {
    let results = searchAssets(inputValue);
    // Apply filter if provided
    if (filter) {
      results = results.filter(filter);
    }
    setSearchResults(results);
    setHighlightedIndex(-1);
  }, [inputValue, filter]);

  const selectAsset = (asset: SupportedAsset) => {
    isTypingRef.current = false;
    setInputValue(asset.symbol);
    setIsOpen(false);
    setHighlightedIndex(-1);
    onChange(asset, asset.symbol);
    inputRef.current?.blur();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    isTypingRef.current = true;
    setInputValue(newValue);
    setIsOpen(true);
    
    // Only call onChange with the symbol for typing, not the full async handler
    // This prevents the parent from triggering async operations on every keystroke
    // The parent will only get the full asset when user selects from dropdown
    const results = searchAssets(newValue);
    const matchingAsset = results.find(asset => 
      asset.symbol.toLowerCase() === newValue.toLowerCase()
    );
    
    // Only pass null for asset to avoid triggering async operations
    onChange(null, newValue);
    
    // Reset typing flag after a short delay
    setTimeout(() => {
      isTypingRef.current = false;
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < searchResults.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : searchResults.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && searchResults[highlightedIndex]) {
          selectAsset(searchResults[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };


  const handleFocus = () => {
    setIsOpen(true);
  };

  // logoUrl function no longer needed - using CryptoIcon component

  return (
    <div className="asset-input-container" ref={dropdownRef}>
      <div className="asset-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="asset-input"
          autoComplete="off"
        />
        <div className="asset-input-icon">
          {inputValue && (
            <div className="selected-asset-preview">
              <CryptoIcon 
                symbol={inputValue} 
                size={20}
                alt={`${inputValue} logo`}
              />
            </div>
          )}
        </div>
      </div>
      
      {isOpen && searchResults.length > 0 && (
        <div className="asset-dropdown">
          {searchResults.slice(0, 8).map((asset, index) => (
            <div
              key={asset.symbol}
              className={`asset-option ${index === highlightedIndex ? 'highlighted' : ''}`}
              onClick={() => selectAsset(asset)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <div className="asset-option-icon">
                <CryptoIcon 
                  symbol={asset.symbol} 
                  size={24}
                  alt={`${asset.symbol} logo`}
                />
              </div>
              <div className="asset-option-info">
                <div className="asset-symbol">
                  <span 
                    className="asset-symbol-badge"
                    style={{ 
                      backgroundColor: `${getAssetColor(asset.symbol)}22`,
                      color: getAssetColor(asset.symbol)
                    }}
                  >
                    {asset.symbol}
                  </span>
                </div>
                <div className="asset-name">{asset.name}</div>
              </div>
              <div className="asset-rank">#{asset.marketCapRank}</div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .asset-input-container {
          position: relative;
          width: 100%;
        }

        .asset-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .asset-input {
          width: 100%;
          background: var(--surface);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 8px 40px 8px 10px;
          font-size: 14px;
          transition: border-color 0.2s ease;
        }

        .asset-input:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 2px ${getAssetColor('BTC')}22;
        }

        .asset-input-icon {
          position: absolute;
          right: 10px;
          display: flex;
          align-items: center;
          pointer-events: none;
        }

        .selected-asset-preview {
          display: flex;
          align-items: center;
        }

        .asset-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,.18);
          z-index: 1000;
          max-height: 320px;
          overflow-y: auto;
          margin-top: 4px;
        }

        .asset-option {
          display: flex;
          align-items: center;
          padding: 12px;
          cursor: pointer;
          border-bottom: 1px solid var(--border);
          transition: background-color 0.15s ease;
        }

        .asset-option:last-child {
          border-bottom: none;
        }

        .asset-option:hover,
        .asset-option.highlighted {
          background: rgba(125,125,125,.08);
        }

        .asset-option-icon {
          margin-right: 12px;
          display: flex;
          align-items: center;
        }

        .asset-option-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .asset-symbol-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          font-weight: 600;
          font-size: 12px;
        }

        .asset-name {
          font-size: 13px;
          color: var(--muted);
        }

        .asset-rank {
          font-size: 12px;
          color: var(--muted);
          font-weight: 500;
        }

        @media (max-width: 480px) {
          .asset-option {
            padding: 10px;
          }
          
          .asset-option-icon {
            margin-right: 8px;
          }
          
          .asset-name {
            font-size: 12px;
          }
          
          .asset-rank {
            font-size: 11px;
          }
        }
      `}</style>
    </div>
  );
}
