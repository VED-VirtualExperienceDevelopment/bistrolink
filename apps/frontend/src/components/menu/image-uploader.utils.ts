/**
 * BL-257: validación de la imagen y mensajes de error del ImageUploader.
 * BL-54: mensajes para los rechazos del backend (400 formato, 413 tamaño)
 * y para el 400 de S3 cuando la policy rechaza el tamaño.
 *
 * Lógica pura (sin React ni fetch) para poder testearla igual que el resto
 * de los utils del frontend.
 */

/** Tipos que acepta la subida (los mismos que anuncia el componente y valida el backend). */
export const TIPOS_IMAGEN_PERMITIDOS = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Tamaño máximo: 5 MB, igual que el content-length-range de la URL firmada. */
export const TAMANIO_MAXIMO_IMAGEN = 5 * 1024 * 1024;

export const MENSAJE_FORMATO_NO_PERMITIDO =
  "Formato no permitido. Usá una imagen PNG, JPG o WEBP.";
export const MENSAJE_TAMANIO_EXCEDIDO = "La imagen supera el máximo de 5 MB.";

/** Error de la subida directa a S3 (el POST a la URL firmada). */
export class ErrorSubidaAlmacenamiento extends Error {
  constructor(readonly status: number) {
    super(`La subida a S3 respondió ${status}`);
    this.name = "ErrorSubidaAlmacenamiento";
  }
}

function formatearMegas(bytes: number): string {
  return (bytes / (1024 * 1024)).toLocaleString("es-UY", {
    maximumFractionDigits: 1,
  });
}

/**
 * Valida tipo y tamaño antes de pedir la URL firmada.
 * Devuelve el mensaje de error, o null si la imagen es válida.
 */
export function validarImagen(archivo: {
  readonly type: string;
  readonly size: number;
}): string | null {
  if (!(TIPOS_IMAGEN_PERMITIDOS as readonly string[]).includes(archivo.type)) {
    return MENSAJE_FORMATO_NO_PERMITIDO;
  }
  if (archivo.size > TAMANIO_MAXIMO_IMAGEN) {
    return `La imagen pesa ${formatearMegas(archivo.size)} MB. El máximo es 5 MB.`;
  }
  return null;
}

function tieneStatus(err: unknown): err is { status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

/** Mensaje para mostrarle al usuario según dónde falló la subida. */
export function mensajeErrorSubida(err: unknown): string {
  // Falló el POST a S3 con una respuesta. La policy rechaza con 403 si el
  // Content-Type no coincide y con 400 (EntityTooLarge) si se pasa de 5 MB.
  if (err instanceof ErrorSubidaAlmacenamiento) {
    if (err.status === 400 || err.status === 403) {
      return "El almacenamiento rechazó la imagen. Verificá que sea PNG, JPG o WEBP de hasta 5 MB.";
    }
    return "No pudimos guardar la imagen. Probá de nuevo.";
  }

  // fetch tira TypeError cuando no hay respuesta: sin conexión o bloqueo de CORS.
  if (err instanceof TypeError) {
    return "No pudimos conectar con el almacenamiento de imágenes. Revisá tu conexión y probá de nuevo.";
  }

  // Falló el pedido de la URL firmada al backend (apiFetch lanza con status).
  if (tieneStatus(err)) {
    if (err.status === 413) {
      return MENSAJE_TAMANIO_EXCEDIDO;
    }
    if (err.status === 400) {
      return MENSAJE_FORMATO_NO_PERMITIDO;
    }
    if (err.status === 401 || err.status === 403) {
      return "Tu sesión expiró o no tenés permisos para subir imágenes. Volvé a iniciar sesión.";
    }
    return "No pudimos preparar la subida. Probá de nuevo en unos minutos.";
  }

  return "No pudimos subir la imagen. Probá de nuevo.";
}
