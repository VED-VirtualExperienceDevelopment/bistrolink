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