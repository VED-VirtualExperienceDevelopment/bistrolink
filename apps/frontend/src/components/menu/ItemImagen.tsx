'use client';

import { useState } from 'react';
import { esPlaceholder, srcImagenItem } from './item-imagen.utils';

interface ItemImagenProps {
  readonly url?: string | null;
  readonly alt: string;
  readonly className?: string;
  readonly priority?: boolean;
}

/**
 * BL-195 / BL-257: imagen de un ítem del menú con placeholder.
 * 
 * Usa <img> nativa en lugar de next/Image porque las URLs firmadas de S3
 * cambian en cada request y Next Image no puede cachearlas correctamente.
 * Con loading="lazy" igual mejora performance en mobile.
 */
export default function ItemImagen({
  url,
  alt,
  className,
  priority = false,
}: ItemImagenProps) {
  const [urlFallida, setUrlFallida] = useState<string | null>(null);
  const src = srcImagenItem(url, url != null && url === urlFallida);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={800}
      height={450}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => {
        if (!esPlaceholder(src)) {
          setUrlFallida(url ?? null);
        }
      }}
    />
  );
}