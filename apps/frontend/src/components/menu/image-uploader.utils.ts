/**
 * BL-257: validación de la imagen y mensajes de error del ImageUploader.
 * BL-54: mensajes para los rechazos del backend (400 formato, 413 tamaño)
 * y para el 400 de S3 cuando la policy rechaza el tamaño.
 * BL-388: mensajes de la confirmación (la API verifica y reprocesa la
 * imagen) y del límite de pedidos (429).
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

/**
 * BL-388: error de la confirmación (POST /admin/menu/imagenes/confirmar).
 * Envuelve el ApiError para distinguirlo del pedido de la URL firmada: los
 * 400 de la confirmación traen un motivo propio ("El archivo no es una
 * imagen válida", "demasiado grande", "animadas") que se muestra tal cual.
 */
export class ErrorConfirmacionImagen extends Error {
  readonly status: number | undefined;

  constructor(readonly causa: unknown) {
    // ApiError es un Error, pero se acepta cualquier objeto con message
    // (por ejemplo, un error serializado) para no perder el motivo de la API.
    super(mensajeDe(causa) ?? "Falló la confirmación de la imagen");
    this.name = "ErrorConfirmacionImagen";
    this.status = tieneStatus(causa) ? causa.status : undefined;
  }
}

export const MENSAJE_DEMASIADOS_INTENTOS =
  "Hiciste muchos intentos seguidos. Esperá un minuto y probá de nuevo.";
export const MENSAJE_SIN_PERMISO =
  "Tu sesión expiró o no tenés permisos para subir imágenes. Volvé a iniciar sesión.";

function mensajeDe(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return undefined;
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
  // BL-388: falló la confirmación. Los rechazos de la verificación (400),
  // imagen vencida o inexistente (404) y tamaño real (413) traen el motivo
  // redactado por la API.
  if (err instanceof ErrorConfirmacionImagen) {
    if (
      (err.status === 400 || err.status === 404 || err.status === 413) &&
      err.message
    ) {
      return err.message;
    }
    if (err.status === 429) {
      return MENSAJE_DEMASIADOS_INTENTOS;
    }
    if (err.status === 401 || err.status === 403) {
      return MENSAJE_SIN_PERMISO;
    }
    return "No pudimos procesar la imagen. Probá de nuevo.";
  }

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
    if (err.status === 429) {
      return MENSAJE_DEMASIADOS_INTENTOS;
    }
    if (err.status === 401 || err.status === 403) {
      return MENSAJE_SIN_PERMISO;
    }
    return "No pudimos preparar la subida. Probá de nuevo en unos minutos.";
  }

  return "No pudimos subir la imagen. Probá de nuevo.";
}
