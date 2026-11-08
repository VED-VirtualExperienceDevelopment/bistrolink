/**
 * HU-009 (BL-454): descarga de un archivo que la API devuelve en base64
 * (por ejemplo, el PDF de un comprobante). Se arma un Blob y se dispara la
 * descarga con un enlace temporal, sin abrir otra pestaña.
 */

/** Respuesta de la API con un archivo en base64. */
export interface ArchivoBase64 {
  nombreArchivo: string;
  mimeType: string;
  contenido: string;
}

/** Bytes de un texto base64. */
export function bytesDesdeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.codePointAt(i) ?? 0;
  }
  return bytes;
}

/** Dispara la descarga del archivo en el navegador. */
export function descargarArchivo(archivo: ArchivoBase64): void {
  const blob = new Blob([bytesDesdeBase64(archivo.contenido)], {
    type: archivo.mimeType,
  });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = archivo.nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Después del click: el navegador ya tomó el archivo.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
