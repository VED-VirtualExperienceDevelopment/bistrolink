export const TIPOS_IMAGEN_PERMITIDOS = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type TipoImagenPermitido = (typeof TIPOS_IMAGEN_PERMITIDOS)[number];

// La extensión sale del MIME validado, nunca del nombre que manda el cliente.
export const EXTENSION_POR_TIPO: Record<TipoImagenPermitido, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const TAMANIO_MAXIMO_IMAGEN_BYTES = 5 * 1024 * 1024;
export const TTL_URL_SUBIDA_SEGUNDOS = 300;
export const TTL_URL_LECTURA_SEGUNDOS = 3600;

// ── Carga segura de imágenes (BL-385) ───────────────────────────────────────
//
// Flujo: el navegador sube a la cuarentena → la API verifica y reprocesa →
// solo se publica la imagen nueva que generó el servidor.

/**
 * Prefijo de cuarentena. Lo que se sube queda acá hasta que la API lo
 * confirma. Nunca se firma para lectura ni se acepta como imagen de un ítem.
 * El bucket lo borra solo a 1 día (regla de ciclo de vida, BL-389).
 */
export const PREFIJO_CUARENTENA = 'incoming';

/** Formatos reales aceptados, según el contenido (no según lo declarado). */
export const FORMATOS_REALES_PERMITIDOS = ['jpeg', 'png', 'webp'] as const;

/**
 * Límite de píxeles de la imagen original (25 megapíxeles). Frena las
 * "bombas de píxeles": archivos chicos que declaran dimensiones enormes.
 */
export const MAXIMO_PIXELES_ENTRADA = 25_000_000;

/** Lado máximo de la imagen publicada; no se agranda si es más chica. */
export const LADO_MAXIMO_IMAGEN_PX = 1600;

/** Calidad del WebP publicado (0–100). */
export const CALIDAD_WEBP = 82;

/**
 * Tipo y caché de la imagen publicada: los fija el servidor, no el cliente.
 * BL-199: cada imagen confirmada tiene una key nueva ({tenant}/menu/{uuid}.webp),
 * así que nunca se sobrescribe y se puede cachear un año en la CDN y en el
 * navegador sin invalidaciones.
 */
export const CONTENT_TYPE_IMAGEN_PUBLICADA = 'image/webp';
export const CACHE_CONTROL_IMAGEN_PUBLICADA =
  'public, max-age=31536000, immutable';

/** Límites por usuario (rate limiting) de la subida y la confirmación. */
export const LIMITE_SUBIDAS_POR_MINUTO = 20;
export const LIMITE_CONFIRMACIONES_POR_MINUTO = 20;

/** UUID v4 en minúsculas, como lo genera randomUUID(). */
export const PATRON_UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
