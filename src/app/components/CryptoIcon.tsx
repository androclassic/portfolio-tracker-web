'use client';
import { useState } from 'react';
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
  
  const iconUrls = getAssetIconUrl(symbol, size);
  const assetColor = getAssetColor(symbol);
  
  const handleError = () => {
    const nextIndex = currentSourceIndex + 1;
    if (nextIndex < iconUrls.length) {
      setCurrentSourceIndex(nextIndex);
      setHasError(false);
    } else {
      setHasError(true);
    }
  };

  const handleLoad = () => {
    setHasError(false);
  };

  // If all sources failed, show a colored fallback
  if (hasError || currentSourceIndex >= iconUrls.length) {
    return (
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
  }

  return (
    <Image
      src={iconUrls[currentSourceIndex]}
      width={size}
      height={size}
      alt={alt || `${symbol} logo`}
      className={className}
      style={{
        borderRadius: 4,
        background: '#00000010',
        ...style
      }}
      onError={handleError}
      onLoad={handleLoad}
      unoptimized // Allow fallback to different domains
    />
  );
}
