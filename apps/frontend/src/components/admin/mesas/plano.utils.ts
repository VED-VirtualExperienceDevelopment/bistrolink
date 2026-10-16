import type { ZonaPlano } from "@/types/plano";
import { limitarCentro, type Lienzo } from "./mapa-mesas.utils";

/**
 * HU-028 (BL-173): lógica pura del plano del salón (zonas y, en el paso
 * siguiente, elementos fijos). Los límites copian los de PlanoDto del
 * backend, para que lo que arma el editor nunca termine en un 400 al guardar.
 */

// --- Zonas ----------------------------------------------------------------------

export const MAXIMO_ZONAS_PLANO = 30;
export const LARGO_MAXIMO_ETIQUETA_ZONA = 30;
export const DIMENSION_MAXIMA_ZONA = 5_000;
/** Más chica no se puede leer la etiqueta ni agarrar con el mouse. */
export const DIMENSION_MINIMA_ZONA = 60;

const ANCHO_ZONA_POR_DEFECTO = 300;
const ALTO_ZONA_POR_DEFECTO = 200;

/** Mismo patrón que el backend: letras, números, espacios y . , ' ( ) - */
const ETIQUETA_PERMITIDA = /^[\p{L}\p{N} .,'()-]+$/u;

/** Mitad del ancho y del alto: las zonas no se rotan. */
export function semiExtensionZona(zona: Pick<ZonaPlano, "ancho" | "alto">): {
  dx: number;
  dy: number;
} {
  return { dx: zona.ancho / 2, dy: zona.alto / 2 };
}

/** Primer "Zona N" libre, para que dos zonas nuevas no se llamen igual. */
export function siguienteEtiquetaZona(zonas: Pick<ZonaPlano, "etiqueta">[]) {
  const usadas = new Set(zonas.map((z) => z.etiqueta.trim().toLowerCase()));
  let n = 1;
  while (usadas.has(`zona ${n}`)) n += 1;
  return `Zona ${n}`;
}

export function puedeAgregarZona(zonas: ZonaPlano[]): boolean {
  return zonas.length < MAXIMO_ZONAS_PLANO;
}

/**
 * Zona nueva con el tamaño por defecto. Cada una se corre un poco respecto
 * de la anterior para que no queden apiladas en el mismo lugar, y se acota
 * para que siempre aparezca entera a la vista.
 */
export function nuevaZona(
  id: string,
  zonas: ZonaPlano[],
  lienzo: Lienzo,
): ZonaPlano {
  const desplazamiento = (zonas.length % 5) * 30;
  const zona: ZonaPlano = {
    id,
    etiqueta: siguienteEtiquetaZona(zonas),
    x: ANCHO_ZONA_POR_DEFECTO / 2 + 20 + desplazamiento,
    y: ALTO_ZONA_POR_DEFECTO / 2 + 20 + desplazamiento,
    ancho: Math.min(ANCHO_ZONA_POR_DEFECTO, lienzo.ancho),
    alto: Math.min(ALTO_ZONA_POR_DEFECTO, lienzo.alto),
  };
  return { ...zona, ...limitarCentro(zona, semiExtensionZona(zona), lienzo) };
}

/**
 * Valida el nombre que escribe el administrador. Devuelve el mensaje de
 * error para mostrar, o null si está bien. Mismas reglas que el backend.
 */
export function errorEtiquetaZona(etiqueta: string): string | null {
  const texto = etiqueta.trim();
  if (texto.length === 0) return "La zona necesita un nombre.";
  if (texto.length > LARGO_MAXIMO_ETIQUETA_ZONA) {
    return `El nombre puede tener hasta ${LARGO_MAXIMO_ETIQUETA_ZONA} caracteres.`;
  }
  if (!ETIQUETA_PERMITIDA.test(texto)) {
    return "Usá solo letras, números, espacios y los signos . , ' ( ) -";
  }
  return null;
}

/**
 * Para el boundBoxFunc del Transformer de una zona. El recuadro llega en
 * píxeles de pantalla (con zoom). Si un borde se pasa del lienzo, se recorta
 * ahí (en vez de rechazar todo el cambio: así el otro lado puede seguir
 * creciendo). Si queda más chica que el mínimo, se mantiene la anterior.
 */
export function acotarRecuadroZona<
  T extends { x: number; y: number; width: number; height: number },
>(anterior: T, nuevo: T, zoom: number, lienzo: Lienzo): T {
  const maximoAncho = Math.min(lienzo.ancho, DIMENSION_MAXIMA_ZONA) * zoom;
  const maximoAlto = Math.min(lienzo.alto, DIMENSION_MAXIMA_ZONA) * zoom;
  const izquierda = Math.max(nuevo.x, 0);
  const arriba = Math.max(nuevo.y, 0);
  const derecha = Math.min(nuevo.x + nuevo.width, lienzo.ancho * zoom);
  const abajo = Math.min(nuevo.y + nuevo.height, lienzo.alto * zoom);
  const width = Math.min(derecha - izquierda, maximoAncho);
  const height = Math.min(abajo - arriba, maximoAlto);
  if (
    width < DIMENSION_MINIMA_ZONA * zoom ||
    height < DIMENSION_MINIMA_ZONA * zoom
  ) {
    return anterior;
  }
  return { ...nuevo, x: izquierda, y: arriba, width, height };
}

/** Igual que dimensionesTrasTransformar de las mesas, con los topes de zona. */
export function dimensionesZonaTrasTransformar(
  ancho: number,
  alto: number,
  scaleX: number,
  scaleY: number,
): { ancho: number; alto: number } {
  const acotar = (valor: number) =>
    Math.min(DIMENSION_MAXIMA_ZONA, Math.max(DIMENSION_MINIMA_ZONA, valor));
  return { ancho: acotar(ancho * scaleX), alto: acotar(alto * scaleY) };
}

/** Ancho que necesita el lienzo para mostrar todas las zonas enteras. */
export function anchoNecesarioZonas(zonas: ZonaPlano[]): number {
  return zonas.reduce(
    (maximo, zona) => Math.max(maximo, zona.x + zona.ancho / 2),
    0,
  );
}
