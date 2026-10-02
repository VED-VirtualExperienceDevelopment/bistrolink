'use client';

import { useState } from 'react';
import { esPlaceholder, srcImagenItem } from './item-imagen.utils';

interface ItemImagenProps {
  /** URL firmada que devuelve el backend. null/undefined si el ítem no tiene imagen o no se pudo firmar. */
  readonly url?: string | null;
  readonly alt: string;
  readonly className?: string;
}

/**
 * BL-195 / BL-257: imagen de un ítem del menú con placeholder.
 *
 * Si no hay URL o la imagen falla al cargar (404 en S3, URL vencida, etc.),
 * muestra el placeholder local en lugar de una imagen rota o un hueco, así
 * el layout de la tarjeta no cambia.
 *
 * Se guarda la URL que falló (y no un booleano) para que, si el ítem cambia
 * de imagen (ej. se edita en el admin), la nueva URL se intente cargar de nuevo.
 */
export default function ItemImagen({ url, alt, className }: ItemImagenProps) {
  const [urlFallida, setUrlFallida] = useState<string | null>(null);
  const src = srcImagenItem(url, url != null && url === urlFallida);

    return (
    // URLs firmadas: cambian en cada request y el optimizador de next/image no
    // puede cachearlas (ver BL-199). Volver a <Image /> cuando haya CDN.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        // Si el que falla es el placeholder, no hay nada más que probar.
        if (!esPlaceholder(src)) {
          setUrlFallida(url ?? null);
        }
      }}
    />
  );
}
