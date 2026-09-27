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
} from '@/types/mesa';

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
  LIBRE: '#4C9A5A',
  OCUPADA: '#BA1A1A',
  EN_PROCESO_DE_PAGO: '#C9A74D',
};

const LAYOUT_POR_DEFECTO = {
  forma: 'CIRCULO' as FormaMesa,
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
    x: OFFSET_GRID_DEFECTO + (indice % COLUMNAS_GRID_DEFECTO) * ESPACIADO_GRID_DEFECTO,
    y: OFFSET_GRID_DEFECTO + Math.floor(indice / COLUMNAS_GRID_DEFECTO) * ESPACIADO_GRID_DEFECTO,
  };
}

/** Convierte la respuesta de GET /mesas/layout al estado editable del canvas. */
export function mesasConLayoutAEdicion(mesas: MesaConLayout[]): MesaEnEdicion[] {
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
export function nuevaMesaEnEdicion(clientId: string, numero: number, indice: number): MesaEnEdicion {
  return {
    clientId,
    numero,
    estado: 'LIBRE',
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
export function siguienteNumeroDisponible(mesas: Pick<MesaEnEdicion, 'numero'>[]): number {
  const usados = new Set(mesas.map((m) => m.numero));
  let candidato = 1;
  while (usados.has(candidato)) candidato += 1;
  return candidato;
}

/** Números de mesa repetidos en el mapa actual — el backend los rechazaría con 409 (constraint único por restaurante). */
export function numerosDuplicados(mesas: Pick<MesaEnEdicion, 'numero'>[]): number[] {
  const vistos = new Map<number, number>();
  for (const { numero } of mesas) {
    vistos.set(numero, (vistos.get(numero) ?? 0) + 1);
  }
  return [...vistos.entries()].filter(([, cantidad]) => cantidad > 1).map(([numero]) => numero);
}

/** Arma el body de POST /mesas/layout a partir del estado editable del canvas. */
export function aGuardarLayoutItems(mesas: MesaEnEdicion[]): GuardarLayoutItem[] {
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
 * Regla de permisos del editor (checklist BL-160): solo el Administrador
 * edita; el Colaborador (MOZO) ve el mapa en modo solo lectura. Extraída del
 * componente para poder testearla sin montar el canvas, igual que
 * resolverDestinoLanding en landing.utils.ts.
 */
export function puedeEditarMapa(hasRole: (rol: 'ADMIN') => boolean): boolean {
  return hasRole('ADMIN');
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

/**
 * Aplica al estado del editor un evento WS 'mesa:estado_actualizado'. Solo
 * cambia el estado de la mesa con ese id; las mesas nuevas (sin id todavía)
 * y el resto del layout no se tocan.
 */
export function aplicarEstadoMesa(
  mesas: MesaEnEdicion[],
  payload: Pick<MesaEstadoActualizadoPayload, 'mesaId' | 'estado'>,
): MesaEnEdicion[] {
  return mesas.map((m) => (m.id === payload.mesaId ? { ...m, estado: payload.estado } : m));
}
