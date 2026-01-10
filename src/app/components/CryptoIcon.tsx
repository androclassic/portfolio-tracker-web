'use client';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { getAssetIconUrl, getAssetColor } from '../../lib/assets';

interface CryptoIconProps {
  symbol: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}

export default function CryptoIcon({ 
  symbol, 
  size = 24, 
  className = '', 
  style = {},
  alt 
}: CryptoIconProps) {
  const [currentSourceIndex, setCurrentSourceIndex] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const iconUrls = getAssetIconUrl(symbol, size);
  const assetColor = getAssetColor(symbol);
  
  // Reset states when symbol changes
  useEffect(() => {
    setCurrentSourceIndex(0);
    setHasError(false);
    setIsLoading(true);
  }, [symbol]);
  
  const handleError = () => {
    const nextIndex = currentSourceIndex + 1;
    if (nextIndex < iconUrls.length) {
      setCurrentSourceIndex(nextIndex);
      setHasError(false);
      setIsLoading(true);
    } else {
      setHasError(true);
      setIsLoading(false);
    }
  };

  const handleLoad = () => {
    setHasError(false);
    setIsLoading(false);
  };

  // Render fallback component (used for loading and error states)
  const renderFallback = () => (
    <div
      className={`crypto-icon-fallback ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: assetColor,
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        fontSize: Math.max(8, size * 0.4),
        fontWeight: 'bold',
        ...style
      }}
      title={alt || `${symbol} icon`}
    >
      {symbol.charAt(0).toUpperCase()}
    </div>
  );

  // If all sources failed, show only the colored fallback
  if (hasError || currentSourceIndex >= iconUrls.length) {
    return renderFallback();
  }

  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-block' }}>
      {/* Show fallback while loading */}
      {isLoading && (
        <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
          {renderFallback()}
        </div>
      )}
      <Image
        src={iconUrls[currentSourceIndex]}
        width={size}
        height={size}
        alt={alt || `${symbol} logo`}
        className={className}
        style={{
          borderRadius: 4,
          background: '#00000010',
          opacity: isLoading ? 0 : 1,
          transition: 'opacity 0.2s ease-in-out',
          ...style
        }}
        onError={handleError}
        onLoad={handleLoad}
        unoptimized // Allow fallback to different domains
      />
    </div>
  );
}
