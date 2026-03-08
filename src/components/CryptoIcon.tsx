/* eslint-disable @next/next/no-img-element */
'use client';
import { useEffect, useState } from 'react';
import { getAssetColor, getAssetIconUrl } from '@/lib/assets';

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
  alt,
}: CryptoIconProps) {
  const [hasError, setHasError] = useState(false);

  const iconUrls = getAssetIconUrl(symbol, size);
  const iconUrl = iconUrls[0];
  const assetColor = getAssetColor(symbol);

  useEffect(() => {
    setHasError(false);
  }, [symbol]);

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
        ...style,
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
    <img
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
        ...style,
      }}
      onError={() => setHasError(true)}
      loading="eager"
      title={alt || `${symbol} logo`}
    />
  );
}
