import type {
  ElementoPlano,
  TipoElementoPlano,
  ZonaPlano,
} from "@/types/plano";
import {
  limitarCentro,
  normalizarRotacion,
  semiExtension,
  type Lienzo,
} from "./mapa-mesas.utils";

/**
 * HU-028 (BL-173): lógica pura del plano del salón (zonas y elementos
 * fijos). Los límites copian los de PlanoDto del
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

// --- Elementos fijos ------------------------------------------------------------

export const MAXIMO_ELEMENTOS_PLANO = 100;
/** Más chico no entra el ícono. */
export const DIMENSION_MINIMA_ELEMENTO = 20;
/** Mismo tope que el backend (DIMENSION_MAXIMA_MESA en PlanoDto). */
export const DIMENSION_MAXIMA_ELEMENTO = 1_000;

/** Tamaño con el que aparece cada elemento nuevo (después se puede cambiar). */
export const TAMANO_POR_ELEMENTO: Record<
  TipoElementoPlano,
  { ancho: number; alto: number }
> = {
  PUERTA: { ancho: 70, alto: 24 },
  BANO: { ancho: 80, alto: 80 },
  COCINA: { ancho: 160, alto: 110 },
  CAJA: { ancho: 90, alto: 60 },
  BARRA: { ancho: 220, alto: 60 },
};

/**
 * Mitad del ancho y del alto que ocupa en pantalla. Un elemento se rota
 * como una mesa rectangular, así que se reusa semiExtension (BL-58): con la
 * caja envolvente, el elemento entra entero en el lienzo en cualquier ángulo.
 */
export function semiExtensionElemento(
  elemento: Pick<ElementoPlano, "ancho" | "alto" | "rotacion">,
): { dx: number; dy: number } {
  return semiExtension({ forma: "RECTANGULO", ...elemento });
}

export function puedeAgregarElemento(elementos: ElementoPlano[]): boolean {
  return elementos.length < MAXIMO_ELEMENTOS_PLANO;
}

/**
 * Elemento nuevo en el centro del lienzo. Cada uno se corre un poco para que
 * no queden apilados, y se acota para que aparezca entero a la vista.
 */
export function nuevoElemento(
  id: string,
  tipo: TipoElementoPlano,
  elementos: ElementoPlano[],
  lienzo: Lienzo,
): ElementoPlano {
  const desplazamiento = (elementos.length % 5) * 40;
  const elemento: ElementoPlano = {
    id,
    tipo,
    x: lienzo.ancho / 2 + desplazamiento,
    y: lienzo.alto / 2 + desplazamiento,
    ...TAMANO_POR_ELEMENTO[tipo],
    rotacion: 0,
  };
  return {
    ...elemento,
    ...limitarCentro(elemento, semiExtensionElemento(elemento), lienzo),
  };
}

/**
 * Botón "Girar 90°": alternativa al giro con el mouse (por ejemplo, para
 * poner una puerta en una pared lateral). Reacomoda el centro para que el
 * elemento girado siga entrando en el lienzo.
 */
export function girarElemento90(
  elemento: ElementoPlano,
  lienzo: Lienzo,
): Pick<ElementoPlano, "x" | "y" | "rotacion"> {
  const rotacion = normalizarRotacion(elemento.rotacion + 90);
  const girado = { ...elemento, rotacion };
  return {
    rotacion,
    ...limitarCentro(girado, semiExtensionElemento(girado), lienzo),
  };
}

/** Para el boundBoxFunc del Transformer (recuadro en píxeles de pantalla). */
export function tamanoElementoPermitido(
  recuadro: { width: number; height: number },
  zoom: number,
): boolean {
  const ancho = recuadro.width / zoom;
  const alto = recuadro.height / zoom;
  return (
    ancho >= DIMENSION_MINIMA_ELEMENTO &&
    alto >= DIMENSION_MINIMA_ELEMENTO &&
    ancho <= DIMENSION_MAXIMA_ELEMENTO &&
    alto <= DIMENSION_MAXIMA_ELEMENTO
  );
}

export function dimensionesElementoTrasTransformar(
  ancho: number,
  alto: number,
  scaleX: number,
  scaleY: number,
): { ancho: number; alto: number } {
  const acotar = (valor: number) =>
    Math.min(
      DIMENSION_MAXIMA_ELEMENTO,
      Math.max(DIMENSION_MINIMA_ELEMENTO, valor),
    );
  return { ancho: acotar(ancho * scaleX), alto: acotar(alto * scaleY) };
}

/** Ancho que necesita el lienzo para mostrar todos los elementos enteros. */
export function anchoNecesarioElementos(elementos: ElementoPlano[]): number {
  return elementos.reduce(
    (maximo, elemento) =>
      Math.max(maximo, elemento.x + semiExtensionElemento(elemento).dx),
    0,
  );
}

const TAMANO_MINIMO_ICONO = 12;
const TAMANO_MAXIMO_ICONO = 32;
const ALTO_ETIQUETA = 14; // fontSize 12
const ANCHO_POR_LETRA = 7; // aproximado, fontSize 12
const SEPARACION = 4;

export interface DisposicionElemento {
  icono: { x: number; y: number; tamano: number };
  etiqueta: {
    x: number;
    y: number;
    ancho: number;
    alineacion: "center" | "left";
  } | null;
}

/**
 * Dónde van el ícono y el nombre dentro del elemento, relativo a su centro.
 * El contenido se dibuja siempre derecho (como el número de una mesa), así
 * que se calcula sobre lo que ocupa en pantalla (la caja envolvente):
 * - con espacio de alto, el nombre va debajo del ícono;
 * - con espacio de ancho, a la derecha (una barra o una puerta horizontal);
 * - si no entra, solo el ícono.
 * Devuelve la esquina superior izquierda del ícono.
 */
export function disposicionElemento(
  elemento: Pick<ElementoPlano, "ancho" | "alto" | "rotacion">,
  etiqueta: string,
): DisposicionElemento {
  const { dx, dy } = semiExtensionElemento(elemento);
  const ancho = dx * 2;
  const alto = dy * 2;
  const tamano = Math.min(
    TAMANO_MAXIMO_ICONO,
    Math.max(TAMANO_MINIMO_ICONO, Math.min(ancho, alto) - 8),
  );
  const anchoTexto = etiqueta.length * ANCHO_POR_LETRA;

  if (
    alto >= tamano + SEPARACION + ALTO_ETIQUETA + 8 &&
    ancho >= anchoTexto + 8
  ) {
    const arriba = -(tamano + SEPARACION + ALTO_ETIQUETA) / 2;
    return {
      icono: { x: -tamano / 2, y: arriba, tamano },
      etiqueta: {
        x: -ancho / 2,
        y: arriba + tamano + SEPARACION,
        ancho,
        alineacion: "center",
      },
    };
  }

  const anchoTotal = tamano + SEPARACION + anchoTexto;
  if (ancho >= anchoTotal + 8) {
    const izquierda = -anchoTotal / 2;
    return {
      icono: { x: izquierda, y: -tamano / 2, tamano },
      etiqueta: {
        x: izquierda + tamano + SEPARACION,
        y: -ALTO_ETIQUETA / 2,
        ancho: anchoTexto + 8,
        alineacion: "left",
      },
    };
  }

  return { icono: { x: -tamano / 2, y: -tamano / 2, tamano }, etiqueta: null };
}
