import React, { useState } from 'react';

// Global cache of known hotlinking domains or failed URLs
const hotlinkedDomains = /(?:bohaishibei\.com|\.qpic\.cn|\.sinaimg\.cn|\.zhimg\.com)/i;
const globalFailedUrls = new Set<string>();

/**
 * Resolves an image URL to a safe proxy URL if it belongs to a known
 * hotlinking-protected domain or has previously failed.
 */
export function resolveSafeImageUrl(src?: string): string | undefined {
  if (!src) return undefined;
  if (src.includes('/api/reader/proxy/image')) return src;

  try {
    const urlObj = new URL(src);
    if (hotlinkedDomains.test(urlObj.hostname) || globalFailedUrls.has(src)) {
      return `/api/reader/proxy/image?url=${encodeURIComponent(src)}`;
    }
  } catch {
    // If not a valid full URL, return as-is
  }
  return src;
}

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
  // Synchronously derived state: reset immediately when `src` changes
  // (render-phase adjustment) to avoid painting the previous article's image.
  const initialSrc = resolveSafeImageUrl(src);
  const [trackedSrc, setTrackedSrc] = useState<string | undefined>(src);
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(initialSrc);
  const [hasTriedProxy, setHasTriedProxy] = useState<boolean>(
    Boolean(initialSrc && initialSrc.includes('/api/reader/proxy/image'))
  );
  const [isFailed, setIsFailed] = useState<boolean>(false);

  if (src !== trackedSrc) {
    setTrackedSrc(src);
    const resolved = resolveSafeImageUrl(src);
    setCurrentSrc(resolved);
    setHasTriedProxy(Boolean(resolved && resolved.includes('/api/reader/proxy/image')));
    setIsFailed(false);
  }

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (!hasTriedProxy && src && src.startsWith('http') && !src.includes('/api/reader/proxy/image')) {
      globalFailedUrls.add(src);
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
      key={currentSrc}
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
