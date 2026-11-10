/**
 * HU-038 (BL-208): tiempo de espera de las comandas del KDS.
 * Lógica pura del tablero (probada en test/unitarios/espera-kds.utils.spec.ts).
 *
 * El tiempo se mide desde `createdAt` del pedido. El tablero pasa la hora
 * actual (`ahora`) desde un reloj que se actualiza solo, así el color y el
 * texto cambian aunque no llegue ningún evento por el socket.
 */

/** Nivel de espera de una comanda, de menor a mayor urgencia. */
export type NivelEspera = "a-tiempo" | "atencion" | "demorado" | "demora-alta";

/**
 * Minutos desde los que empieza cada nivel. Debe cumplirse
 * atencion < demorado < demoraAlta.
 */
export interface UmbralesEspera {
  atencion: number;
  demorado: number;
  demoraAlta: number;
}

/**
 * Valores por defecto. Cada local los puede cambiar en Configuración › Cocina;
 * mientras no lo haga, se usan estos.
 */
export const UMBRALES_ESPERA_POR_DEFECTO: Readonly<UmbralesEspera> = {
  atencion: 30,
  demorado: 60,
  demoraAlta: 120,
};

/** Cada cuánto se actualiza el tiempo de las comandas. */
export const INTERVALO_RELOJ_MS = 30_000;

const MS_POR_MINUTO = 60_000;

/** Etiqueta visible de cada nivel (texto, no solo color: WCAG 1.4.1). */
export const ETIQUETA_NIVEL_ESPERA: Readonly<Record<NivelEspera, string>> = {
  "a-tiempo": "A tiempo",
  atencion: "Atención",
  demorado: "Demorado",
  "demora-alta": "Demora alta",
};

/**
 * Minutos enteros que pasaron desde `desdeIso` hasta `ahora` (ms epoch).
 * Nunca negativo: si el reloj del tablero quedó unos segundos atrás de un
 * pedido recién llegado, da 0. Con una fecha inválida también da 0.
 */
export function minutosDeEspera(desdeIso: string, ahora: number): number {
  const desde = new Date(desdeIso).getTime();
  if (Number.isNaN(desde)) return 0;
  return Math.max(0, Math.floor((ahora - desde) / MS_POR_MINUTO));
}

/** Nivel de espera según los minutos y los umbrales del local. */
export function nivelDeEspera(
  minutos: number,
  umbrales: UmbralesEspera = UMBRALES_ESPERA_POR_DEFECTO,
): NivelEspera {
  if (minutos >= umbrales.demoraAlta) return "demora-alta";
  if (minutos >= umbrales.demorado) return "demorado";
  if (minutos >= umbrales.atencion) return "atencion";
  return "a-tiempo";
}

/**
 * Texto corto para leer de lejos: «Recién llegado», «hace 12 min»,
 * «hace 2 h» o «hace 1 h 5 min».
 */
export function textoEspera(minutos: number): string {
  if (minutos < 1) return "Recién llegado";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `hace ${horas} h` : `hace ${horas} h ${resto} min`;
}
