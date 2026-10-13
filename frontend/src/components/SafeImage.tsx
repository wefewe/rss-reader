import React, { useState, useEffect } from 'react';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  onImageClick?: (currentValidSrc: string) => void;
}

export const SafeImage: React.FC<SafeImageProps> = ({
  src,
  alt,
  className,
  onImageClick,
  onError,
  ...props
}) => {
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(src);
  const [hasTriedProxy, setHasTriedProxy] = useState<boolean>(false);
  const [isFailed, setIsFailed] = useState<boolean>(false);

  useEffect(() => {
    setCurrentSrc(src);
    setHasTriedProxy(false);
    setIsFailed(false);
  }, [src]);

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    // If not tried proxy yet and it's a valid remote URL, fallback to image proxy
    if (!hasTriedProxy && src && src.startsWith('http') && !src.includes('/api/reader/proxy/image')) {
      setHasTriedProxy(true);
      const proxyUrl = `/api/reader/proxy/image?url=${encodeURIComponent(src)}`;
      setCurrentSrc(proxyUrl);
    } else {
      setIsFailed(true);
      if (onError) onError(e);
    }
  };

  if (isFailed || !currentSrc) {
    return null;
  }

  return (
    <img
      src={currentSrc}
      alt={alt || ''}
      className={className}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={handleError}
      onClick={() => onImageClick && onImageClick(currentSrc)}
      {...props}
    />
  );
};
