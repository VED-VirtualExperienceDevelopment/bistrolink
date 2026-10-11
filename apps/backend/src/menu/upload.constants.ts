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
