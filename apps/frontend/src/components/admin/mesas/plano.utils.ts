import {
  TIPOS_ELEMENTO_PLANO,
  type ElementoPlano,
  type PlanoSalon,
  type TipoElementoPlano,
  type ZonaPlano,
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

// --- Guardar y cargar (GET /mesas/plano, POST /mesas/layout) --------------------

export const PLANO_VACIO: PlanoSalon = { elementos: [], zonas: [] };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function sonNumeros(objeto: Record<string, unknown>, claves: string[]) {
  return claves.every(
    (clave) =>
      typeof objeto[clave] === "number" && Number.isFinite(objeto[clave]),
  );
}

function esTipoElemento(valor: unknown): valor is TipoElementoPlano {
  return (TIPOS_ELEMENTO_PLANO as readonly unknown[]).includes(valor);
}

/**
 * Pasa la respuesta de GET /mesas/plano al formato del editor. El backend ya
 * valida al guardar, pero el JSON viene de la base: si algo no tiene la
 * forma esperada, se descarta ese elemento en vez de romper el mapa.
 */
export function normalizarPlano(datos: unknown): PlanoSalon {
  if (!esObjeto(datos)) return PLANO_VACIO;
  const elementos = Array.isArray(datos.elementos) ? datos.elementos : [];
  const zonas = Array.isArray(datos.zonas) ? datos.zonas : [];
  return {
    elementos: elementos
      .filter(
        (e): e is Record<string, unknown> =>
          esObjeto(e) &&
          typeof e.id === "string" &&
          esTipoElemento(e.tipo) &&
          sonNumeros(e, ["x", "y", "ancho", "alto", "rotacion"]),
      )
      .map((e) => ({
        id: e.id as string,
        tipo: e.tipo as TipoElementoPlano,
        x: e.x as number,
        y: e.y as number,
        ancho: e.ancho as number,
        alto: e.alto as number,
        rotacion: e.rotacion as number,
      })),
    zonas: zonas
      .filter(
        (z): z is Record<string, unknown> =>
          esObjeto(z) &&
          typeof z.id === "string" &&
          typeof z.etiqueta === "string" &&
          sonNumeros(z, ["x", "y", "ancho", "alto"]),
      )
      .map((z) => ({
        id: z.id as string,
        etiqueta: z.etiqueta as string,
        x: z.x as number,
        y: z.y as number,
        ancho: z.ancho as number,
        alto: z.alto as number,
      })),
  };
}

/**
 * Arma el `plano` del POST /mesas/layout copiando solo los campos que acepta
 * el backend: el ValidationPipe tiene forbidNonWhitelisted, así que
 * cualquier propiedad de más haría fallar todo el guardado con un 400.
 */
export function aPlanoPayload(
  zonas: ZonaPlano[],
  elementos: ElementoPlano[],
): PlanoSalon {
  return {
    elementos: elementos.map(({ id, tipo, x, y, ancho, alto, rotacion }) => ({
      id,
      tipo,
      x,
      y,
      ancho,
      alto,
      rotacion,
    })),
    zonas: zonas.map(({ id, etiqueta, x, y, ancho, alto }) => ({
      id,
      etiqueta,
      x,
      y,
      ancho,
      alto,
    })),
  };
}

// --- Lista alternativa del plano (accesibilidad) -----------------------------------

/**
 * Nombre de la zona en la que cae un punto (el centro de una mesa o de un
 * elemento), o null si no cae en ninguna. Si dos zonas se superponen, gana
 * la que se dibuja arriba (la última de la lista).
 */
export function zonaDePunto(
  punto: { x: number; y: number },
  zonas: ZonaPlano[],
): string | null {
  for (let i = zonas.length - 1; i >= 0; i -= 1) {
    const zona = zonas[i];
    if (
      Math.abs(punto.x - zona.x) <= zona.ancho / 2 &&
      Math.abs(punto.y - zona.y) <= zona.alto / 2
    ) {
      return zona.etiqueta;
    }
  }
  return null;
}

// --- Cambios sin guardar y atajos de teclado (UX) ---------------------------------

/**
 * Foto de lo que se guardaría, para saber si hay cambios sin guardar:
 * se compara con la foto tomada al cargar o al guardar. Usa los mismos
 * campos que el POST, así que no cuenta lo que no se guarda (por ejemplo,
 * el estado de una mesa que llega por WebSocket).
 */
export function fotoParaGuardar(
  mesas: unknown[],
  zonas: ZonaPlano[],
  elementos: ElementoPlano[],
): string {
  return JSON.stringify({ mesas, plano: aPlanoPayload(zonas, elementos) });
}

export type AccionDeTecla = "eliminar" | "deseleccionar";

/**
 * Atajos del editor: Supr (o Borrar, en Mac) elimina lo seleccionado y Esc
 * deselecciona. No se activan mientras se escribe en un campo de texto,
 * para que Borrar siga borrando letras.
 */
export function accionDeTecla(
  tecla: string,
  enCampoDeTexto: boolean,
): AccionDeTecla | null {
  if (enCampoDeTexto) return null;
  if (tecla === "Delete" || tecla === "Backspace") return "eliminar";
  if (tecla === "Escape") return "deseleccionar";
  return null;
}

export function esCampoDeTexto(
  objetivo: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!objetivo) return false;
  const etiqueta = objetivo.tagName?.toUpperCase();
  return (
    etiqueta === "INPUT" ||
    etiqueta === "TEXTAREA" ||
    etiqueta === "SELECT" ||
    objetivo.isContentEditable === true
  );
}

export type AtajoPlano =
  | { tipo: "acercar" }
  | { tipo: "alejar" }
  | { tipo: "zoom-inicial" }
  | { tipo: "guardar" }
  | { tipo: "deshacer" }
  | { tipo: "mover"; dx: number; dy: number };

/** Lo que mueve una flecha, en unidades del lienzo. */
export const PASO_MOVER_FINO = 1;
/** Lo que mueve Shift + flecha, en unidades del lienzo. */
export const PASO_MOVER_GRUESO = 10;

const DIRECCION_POR_FLECHA: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/**
 * Atajos de teclado del editor del plano (además de Supr y Esc, que siguen
 * en accionDeTecla):
 * - `+` / `-` acercan y alejan, `0` vuelve al 100 %.
 * - Flechas mueven lo seleccionado 1 unidad; con Shift, 10.
 * - Ctrl/Cmd + S guarda, incluso desde un campo de texto.
 * - Ctrl/Cmd + Z deshace la última eliminación (BL-332). En un campo de
 *   texto no: ahí deshace lo que se escribió, como siempre.
 *
 * Solo se escuchan con el foco dentro del editor, así los atajos de una sola
 * tecla no interfieren con el resto de la página (WCAG 2.1.4). Mientras se
 * escribe en un campo no actúa ninguno salvo Ctrl/Cmd + S. Ctrl con + o −
 * queda para el zoom del navegador (WCAG 1.4.4).
 */
export function accionDeAtajo(
  tecla: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  },
  enCampoDeTexto: boolean,
  haySeleccion: boolean,
): AtajoPlano | null {
  const conControl = tecla.ctrlKey || tecla.metaKey;
  if (conControl && !tecla.altKey && tecla.key.toLowerCase() === "s") {
    return { tipo: "guardar" };
  }
  if (
    conControl &&
    !tecla.altKey &&
    !tecla.shiftKey &&
    !enCampoDeTexto &&
    tecla.key.toLowerCase() === "z"
  ) {
    return { tipo: "deshacer" };
  }
  if (enCampoDeTexto || conControl || tecla.altKey) return null;
  if (tecla.key === "+" || tecla.key === "=") return { tipo: "acercar" };
  if (tecla.key === "-") return { tipo: "alejar" };
  if (tecla.key === "0") return { tipo: "zoom-inicial" };
  const direccion = DIRECCION_POR_FLECHA[tecla.key];
  if (direccion && haySeleccion) {
    const paso = tecla.shiftKey ? PASO_MOVER_GRUESO : PASO_MOVER_FINO;
    return { tipo: "mover", dx: direccion[0] * paso, dy: direccion[1] * paso };
  }
  return null;
}
