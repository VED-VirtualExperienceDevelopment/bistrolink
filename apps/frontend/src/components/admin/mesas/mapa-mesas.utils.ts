// Lógica pura del editor, separada del componente Konva a propósito: jsdom
// no implementa <canvas>, así que un test que monte <Stage>/<Layer> real
// necesita mockear todo el motor de render. Lo que sí vale la pena cubrir
// con un test rápido es la lógica de negocio (normalización de rotación,
// detección de números duplicados, armado del payload) — así que vive acá,
// como funciones puras sin ninguna dependencia de react-konva.
import type {
  EstadoMesa,
  FormaMesa,
  GuardarLayoutItem,
  MesaConLayout,
  MesaEstadoActualizadoPayload,
} from "@/types/mesa";

/** Estado local de una mesa mientras se edita en el canvas. */
export interface MesaEnEdicion {
  // Identidad estable para la key de React y para el mapa de refs de Konva.
  // Coincide con el id real si la mesa ya existe; si es nueva, es un id
  // temporal generado en el cliente que nunca se manda al backend.
  clientId: string;
  id?: string;
  numero: number;
  estado: EstadoMesa;
  x: number;
  y: number;
  forma: FormaMesa;
  ancho: number;
  alto: number;
  rotacion: number;
}

export const COLOR_POR_ESTADO: Record<EstadoMesa, string> = {
  LIBRE: "#4C9A5A",
  OCUPADA: "#BA1A1A",
  EN_PROCESO_DE_PAGO: "#C9A74D",
};

const LAYOUT_POR_DEFECTO = {
  forma: "CIRCULO" as FormaMesa,
  ancho: 80,
  alto: 80,
  rotacion: 0,
};

/**
 * Tamaño mínimo (px) de ancho/alto de una mesa al redimensionarla. Lo usan
 * el Transformer (boundBoxFunc) y MesaShape al consumir la escala; queda por
 * encima del @Min(1) de MesaLayoutDto en el backend.
 */
export const DIMENSION_MINIMA_MESA = 20;

/**
 * Tamaño máximo (px) de ancho/alto de una mesa. Mismo valor que
 * DIMENSION_MAXIMA_MESA de MesaLayoutDto en el backend (BL-58): si el editor
 * dejara pasarlo, el guardado fallaría con 400.
 */
export const DIMENSION_MAXIMA_MESA = 1000;

/** Al pasar a rectángulo, el lado largo mide esta proporción del corto. */
const PROPORCION_RECTANGULO = 1.5;

/**
 * Dimensiones de una mesa al cambiarle la forma desde el editor:
 * - círculo y cuadrado tienen ancho = alto (lado: el ancho del círculo o el
 *   lado corto del rectángulo, para que la mesa no crezca de golpe);
 * - un rectángulo se alarga a lo ancho para que el cambio se note, sin
 *   pasar del máximo.
 */
export function cambiarForma(
  mesa: Pick<MesaEnEdicion, "forma" | "ancho" | "alto">,
  forma: FormaMesa,
): Pick<MesaEnEdicion, "forma" | "ancho" | "alto"> {
  if (forma === mesa.forma) {
    return { forma, ancho: mesa.ancho, alto: mesa.alto };
  }
  const lado =
    mesa.forma === "RECTANGULO" ? Math.min(mesa.ancho, mesa.alto) : mesa.ancho;
  if (forma === "RECTANGULO") {
    return {
      forma,
      ancho: Math.min(
        Math.round(lado * PROPORCION_RECTANGULO),
        DIMENSION_MAXIMA_MESA,
      ),
      alto: lado,
    };
  }
  return { forma, ancho: lado, alto: lado };
}

const ESPACIADO_GRID_DEFECTO = 120;
const OFFSET_GRID_DEFECTO = 80;
const COLUMNAS_GRID_DEFECTO = 5;

/**
 * Posición de arranque para una mesa que todavía no tiene layout (nunca se
 * ubicó en el editor). Las acomoda en grilla en vez de amontonarlas todas
 * en (0,0), para que sean fáciles de encontrar y arrastrar a su lugar real.
 */
export function posicionGridPorDefecto(indice: number) {
  return {
    x:
      OFFSET_GRID_DEFECTO +
      (indice % COLUMNAS_GRID_DEFECTO) * ESPACIADO_GRID_DEFECTO,
    y:
      OFFSET_GRID_DEFECTO +
      Math.floor(indice / COLUMNAS_GRID_DEFECTO) * ESPACIADO_GRID_DEFECTO,
  };
}

/** Convierte la respuesta de GET /mesas/layout al estado editable del canvas. */
export function mesasConLayoutAEdicion(
  mesas: MesaConLayout[],
): MesaEnEdicion[] {
  return mesas.map((mesa, indice) => {
    if (mesa.layout) {
      return {
        clientId: mesa.id,
        id: mesa.id,
        numero: mesa.numero,
        estado: mesa.estado,
        ...mesa.layout,
      };
    }
    return {
      clientId: mesa.id,
      id: mesa.id,
      numero: mesa.numero,
      estado: mesa.estado,
      ...posicionGridPorDefecto(indice),
      ...LAYOUT_POR_DEFECTO,
    };
  });
}

/** Layout por defecto para una mesa nueva creada desde el botón "Agregar mesa". */
export function nuevaMesaEnEdicion(
  clientId: string,
  numero: number,
  indice: number,
): MesaEnEdicion {
  return {
    clientId,
    numero,
    estado: "LIBRE",
    ...posicionGridPorDefecto(indice),
    ...LAYOUT_POR_DEFECTO,
  };
}

/**
 * Normaliza un ángulo de Konva (puede venir negativo o mayor a 360 tras
 * varias rotaciones acumuladas) al rango [0, 359] que exige
 * MesaLayoutDto.rotacion (@Min(0) @Max(359)) en el backend.
 */
export function normalizarRotacion(grados: number): number {
  return ((Math.round(grados) % 360) + 360) % 360;
}

/** El próximo número de mesa libre — sugerencia para "Agregar mesa", no una garantía contra colisiones. */
export function siguienteNumeroDisponible(
  mesas: Pick<MesaEnEdicion, "numero">[],
): number {
  const usados = new Set(mesas.map((m) => m.numero));
  let candidato = 1;
  while (usados.has(candidato)) candidato += 1;
  return candidato;
}

/** Números de mesa repetidos en el mapa actual — el backend los rechazaría con 409 (constraint único por restaurante). */
export function numerosDuplicados(
  mesas: Pick<MesaEnEdicion, "numero">[],
): number[] {
  const vistos = new Map<number, number>();
  for (const { numero } of mesas) {
    vistos.set(numero, (vistos.get(numero) ?? 0) + 1);
  }
  return [...vistos.entries()]
    .filter(([, cantidad]) => cantidad > 1)
    .map(([numero]) => numero);
}

/** Arma el body de POST /mesas/layout a partir del estado editable del canvas. */
export function aGuardarLayoutItems(
  mesas: MesaEnEdicion[],
): GuardarLayoutItem[] {
  // clientId y estado son de uso exclusivo del editor (el backend no los
  // conoce): clientId identifica la mesa en el canvas antes de tener un id
  // real, y estado lo cambia HU-017, no este guardado de layout. Se arma el
  // item explícitamente en vez de "restar" campos con rest-destructuring
  // para no terminar con variables declaradas y jamás leídas.
  return mesas.map(({ id, numero, x, y, forma, ancho, alto, rotacion }) => ({
    ...(id ? { id } : {}),
    numero,
    x,
    y,
    forma,
    ancho,
    alto,
    rotacion,
  }));
}
/**
 * BL-58: solo una mesa LIBRE se puede quitar del mapa (una ocupada o en
 * proceso de pago tiene comensales). Si además tiene pedidos registrados,
 * el backend rechaza el guardado con 409: eso el editor no lo sabe.
 */
export function puedeEliminarMesa(
  mesa: Pick<MesaEnEdicion, "estado">,
): boolean {
  return mesa.estado === "LIBRE";
}

/**
 * Quita una mesa del estado del editor. Si ya estaba guardada (tiene id),
 * la agrega a `eliminadas` para mandarla en el próximo guardado; si era
 * nueva, simplemente desaparece. Una mesa que no está libre no se toca.
 */
export function quitarMesa(
  mesas: MesaEnEdicion[],
  eliminadas: MesaEnEdicion[],
  clientId: string,
): { mesas: MesaEnEdicion[]; eliminadas: MesaEnEdicion[] } {
  const mesa = mesas.find((m) => m.clientId === clientId);
  if (!mesa || !puedeEliminarMesa(mesa)) return { mesas, eliminadas };
  return {
    mesas: mesas.filter((m) => m.clientId !== clientId),
    eliminadas: mesa.id ? [...eliminadas, mesa] : eliminadas,
  };
}

/** Ids a mandar en `eliminar` de POST /mesas/layout. */
export function idsAEliminar(eliminadas: MesaEnEdicion[]): string[] {
  return eliminadas.flatMap((m) => (m.id ? [m.id] : []));
}

/**
 * Regla de permisos del editor (checklist BL-160): solo el Administrador
 * edita; el Colaborador (MOZO) ve el mapa en modo solo lectura. Extraída del
 * componente para poder testearla sin montar el canvas, igual que
 * resolverDestinoLanding en landing.utils.ts.
 */
export function puedeEditarMapa(hasRole: (rol: "ADMIN") => boolean): boolean {
  return hasRole("ADMIN");
}

/**
 * Valida el número tipeado en el input de edición (doble clic sobre una
 * mesa). Devuelve null si no es un entero mayor a 0 — el 0 está reservado a
 * la mesa virtual de HU-003 y el backend lo rechaza (@Min(1)).
 */
export function parsearNumeroMesa(valor: string): number | null {
  const numero = Number.parseInt(valor, 10);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

/**
 * Konva expresa un resize como escala (scaleX/scaleY), no como cambio de
 * width/height. Esta función la traduce a las dimensiones nuevas que se
 * guardan en el layout, sin bajar del mínimo.
 */
export function dimensionesTrasTransformar(
  ancho: number,
  alto: number,
  scaleX: number,
  scaleY: number,
): { ancho: number; alto: number } {
  return {
    ancho: Math.max(DIMENSION_MINIMA_MESA, ancho * scaleX),
    alto: Math.max(DIMENSION_MINIMA_MESA, alto * scaleY),
  };
}

// --- Límites del lienzo -------------------------------------------------------
// Sin estos límites, una mesa arrastrada fuera del borde quedaba guardada
// con esas coordenadas pero invisible (el contenedor recorta lo que sale del
// canvas) y no había forma de recuperarla desde el editor.

/** Tamaño del área dibujable del editor, en px. */
export interface Lienzo {
  ancho: number;
  alto: number;
}

/**
 * Mitad del ancho y del alto que ocupa la mesa en pantalla, medidos desde su
 * centro (x, y siempre son el centro, ver MesaShape). Para un rectángulo
 * rotado se usa la caja envolvente alineada a los ejes, así la mesa entera
 * queda dentro del lienzo en cualquier ángulo. El círculo usa ancho/2 como
 * radio, igual que MesaShape.
 */
export function semiExtension({
  forma,
  ancho,
  alto,
  rotacion,
}: Pick<MesaEnEdicion, "forma" | "ancho" | "alto" | "rotacion">): {
  dx: number;
  dy: number;
} {
  if (forma === "CIRCULO") {
    return { dx: ancho / 2, dy: ancho / 2 };
  }
  const radianes = (rotacion * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radianes));
  const sin = Math.abs(Math.sin(radianes));
  return {
    dx: (ancho * cos + alto * sin) / 2,
    dy: (ancho * sin + alto * cos) / 2,
  };
}

function acotar(valor: number, minimo: number, maximo: number): number {
  // Mesa más grande que el lienzo: se centra en vez de oscilar entre bordes.
  if (maximo < minimo) return (minimo + maximo) / 2;
  return Math.min(Math.max(valor, minimo), maximo);
}

/**
 * Ajusta el centro de una mesa para que quede entera dentro del lienzo. La
 * usan el dragBoundFunc de MesaShape (al arrastrar) y el editor (después de
 * redimensionar/rotar y al agregar una mesa).
 */
export function limitarCentro(
  pos: { x: number; y: number },
  extension: { dx: number; dy: number },
  lienzo: Lienzo,
): { x: number; y: number } {
  return {
    x: acotar(pos.x, extension.dx, lienzo.ancho - extension.dx),
    y: acotar(pos.y, extension.dy, lienzo.alto - extension.dy),
  };
}

/**
 * Ancho mínimo que necesita el lienzo para mostrar todas las mesas. El editor
 * usa el mayor entre este valor y el ancho del contenedor: si el panel es
 * más angosto que el salón guardado, aparece scroll horizontal en vez de
 * esconder (o mover) mesas.
 */
export function anchoNecesarioLienzo(mesas: MesaEnEdicion[]): number {
  // Sin margen extra a propósito: el dragBoundFunc deja el borde derecho de
  // la mesa justo en el borde del lienzo, y un margen haría crecer el lienzo
  // un poco cada vez que se arrastra una mesa contra ese borde.
  return mesas.reduce(
    (maximo, mesa) => Math.max(maximo, mesa.x + semiExtension(mesa).dx),
    0,
  );
}

/**
 * Al cargar el mapa, trae dentro del área visible las mesas que hayan
 * quedado afuera (layouts guardados antes de existir estos límites, o
 * mesas sin layout más allá de la quinta fila de la grilla por defecto).
 * Solo corrige lo que el lienzo no puede mostrar: x negativa, y negativa o
 * y mayor al alto. A la derecha no hay tope, porque el lienzo se ensancha
 * (ver anchoNecesarioLienzo). Devuelve cuántas mesas se movieron, para
 * avisarle al administrador que guarde.
 */
export function reubicarFueraDelLienzo(
  mesas: MesaEnEdicion[],
  altoLienzo: number,
): { mesas: MesaEnEdicion[]; reubicadas: number } {
  let reubicadas = 0;
  const ajustadas = mesas.map((mesa) => {
    const { x, y } = limitarCentro(mesa, semiExtension(mesa), {
      ancho: Number.POSITIVE_INFINITY,
      alto: altoLienzo,
    });
    if (x === mesa.x && y === mesa.y) return mesa;
    reubicadas += 1;
    return { ...mesa, x, y };
  });
  return { mesas: ajustadas, reubicadas };
}

/**
 * Aplica al estado del editor un evento WS 'mesa:estado_actualizado'. Solo
 * cambia el estado de la mesa con ese id; las mesas nuevas (sin id todavía)
 * y el resto del layout no se tocan.
 */
export function aplicarEstadoMesa(
  mesas: MesaEnEdicion[],
  payload: Pick<MesaEstadoActualizadoPayload, "mesaId" | "estado">,
): MesaEnEdicion[] {
  return mesas.map((m) =>
    m.id === payload.mesaId ? { ...m, estado: payload.estado } : m,
  );
}
