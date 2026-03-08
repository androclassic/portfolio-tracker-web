'use client';
import { useEffect, useState } from 'react';
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
  const [hasError, setHasError] = useState(false);
  
  const iconUrls = getAssetIconUrl(symbol, size);
  const iconUrl = iconUrls[0];
  const assetColor = getAssetColor(symbol);
  
  // Reset error state when symbol changes
  useEffect(() => {
    setHasError(false);
  }, [symbol]);

  // Render fallback component (used for missing and error states)
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

  if (!iconUrl || hasError) {
    return renderFallback();
  }

  return (
    <Image
      src={iconUrl}
      width={size}
      height={size}
      alt={alt || `${symbol} logo`}
      className={className}
      style={{
        borderRadius: 4,
        background: '#00000010',
        objectFit: 'contain',
        display: 'block',
        ...style
      }}
      onError={() => setHasError(true)}
      loading="eager"
      unoptimized
      title={alt || `${symbol} logo`}
    />
  );
}
