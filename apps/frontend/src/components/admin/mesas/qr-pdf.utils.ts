import type { QrRestaurante } from "@/types/qr-mesa";

/**
 * HU-034 (BL-204): lógica pura del PDF imprimible con los QR de las mesas.
 * Separada de generar-pdf-qr.ts (que usa jsPDF y qrcode) para poder
 * testearla sin navegador.
 */

/** Una tarjeta del PDF: un QR con su título. */
export interface TarjetaQr {
  titulo: string;
  subtitulo: string;
  pie: string;
  url: string;
}

export const PIE_TARJETA_MESA = "Escaneá para ver el menú y hacer tu pedido";
export const PIE_TARJETA_WEB = "Escaneá para pedir y retirar en el local";

/**
 * Tarjetas del PDF, en orden de número de mesa. Con `soloMesaId`, solo la de
 * esa mesa (para reimprimir una sola, por ejemplo después de regenerarla).
 * El link web del local va al final y solo en el PDF completo.
 */
export function tarjetasDeQr(
  datos: QrRestaurante,
  soloMesaId?: string,
): TarjetaQr[] {
  const nombre = datos.restaurante.nombre;
  const mesas = datos.mesas
    .filter((m) => !soloMesaId || m.id === soloMesaId)
    .sort((a, b) => a.numero - b.numero)
    .map((m) => ({
      titulo: `Mesa ${m.numero}`,
      subtitulo: nombre,
      pie: PIE_TARJETA_MESA,
      url: m.url,
    }));

  if (soloMesaId) return mesas;

  return [
    ...mesas,
    {
      titulo: "Pedidos para retirar",
      subtitulo: nombre,
      pie: PIE_TARJETA_WEB,
      url: datos.restaurante.urlWeb,
    },
  ];
}

// Hoja A4 vertical (mm), 2 columnas × 2 filas: cada tarjeta mide medio
// ancho y media altura de la hoja, con un margen alrededor para recortar.
export const HOJA = { ancho: 210, alto: 297 } as const;
export const MARGEN_HOJA = 10;
export const COLUMNAS = 2;
export const FILAS = 2;
export const TARJETAS_POR_HOJA = COLUMNAS * FILAS;
export const TARJETA = {
  ancho: (HOJA.ancho - 2 * MARGEN_HOJA) / COLUMNAS,
  alto: (HOJA.alto - 2 * MARGEN_HOJA) / FILAS,
} as const;

/** Dónde va la tarjeta número `indice` (desde 0): hoja y esquina superior izquierda. */
export function posicionTarjeta(indice: number): {
  hoja: number;
  x: number;
  y: number;
} {
  const enHoja = indice % TARJETAS_POR_HOJA;
  return {
    hoja: Math.floor(indice / TARJETAS_POR_HOJA),
    x: MARGEN_HOJA + (enHoja % COLUMNAS) * TARJETA.ancho,
    y: MARGEN_HOJA + Math.floor(enHoja / COLUMNAS) * TARJETA.alto,
  };
}

/** La tarjeta `indice` abre una hoja nueva (la primera hoja ya existe). */
export function empiezaHojaNueva(indice: number): boolean {
  return indice > 0 && indice % TARJETAS_POR_HOJA === 0;
}

/** "Restaurante Testing A" → "restaurante-testing-a" (sin tildes ni símbolos). */
export function slugArchivo(texto: string): string {
  const slug = texto
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return slug || "restaurante";
}

/** qr-mesas-<restaurante>.pdf, o qr-mesa-<n>-<restaurante>.pdf para una sola. */
export function nombreArchivoPdf(
  nombreRestaurante: string,
  numeroMesa?: number,
): string {
  const slug = slugArchivo(nombreRestaurante);
  return numeroMesa === undefined
    ? `qr-mesas-${slug}.pdf`
    : `qr-mesa-${numeroMesa}-${slug}.pdf`;
}
