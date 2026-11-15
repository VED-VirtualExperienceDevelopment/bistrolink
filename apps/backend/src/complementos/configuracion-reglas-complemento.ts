/**
 * HU-046 (BL-552): parámetros del job nocturno de las reglas de
 * complemento, desde variables de entorno.
 *
 * - COMPLEMENTOS_REGLAS_HABILITADO: «false» apaga el job. En los tests
 *   (NODE_ENV=test) está apagado salvo que se habilite a propósito: los
 *   tests de integración llaman al servicio directamente.
 * - COMPLEMENTOS_REGLAS_HORA (4): a partir de qué hora de Montevideo se
 *   recalcula, una vez por día. De madrugada, cuando no hay servicio.
 *
 * El job revisa cada 15 minutos si ya le toca. Si la API arranca después de
 * esa hora y ese día todavía no recalculó, recalcula en el primer chequeo:
 * así un deploy no deja a los locales sin reglas hasta la noche siguiente.
 */
export interface ConfiguracionReglasComplemento {
  habilitado: boolean;
  /** Hora local (0 a 23) desde la que se recalcula cada día. */
  hora: number;
  /** Cada cuánto se revisa si toca recalcular. */
  chequeoMs: number;
  zonaHoraria: string;
}

export const ZONA_HORARIA_REGLAS = 'America/Montevideo';
const HORA_POR_DEFECTO = 4;
const CHEQUEO_MS = 15 * 60 * 1000;

function horaDelDia(valor: string | undefined): number {
  if (valor === undefined || valor.trim() === '') return HORA_POR_DEFECTO;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 && numero <= 23
    ? numero
    : HORA_POR_DEFECTO;
}

export function configuracionReglasComplemento(
  env: NodeJS.ProcessEnv,
): ConfiguracionReglasComplemento {
  const valor = env.COMPLEMENTOS_REGLAS_HABILITADO?.trim().toLowerCase();
  const habilitado =
    env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false';
  return {
    habilitado,
    hora: horaDelDia(env.COMPLEMENTOS_REGLAS_HORA),
    chequeoMs: CHEQUEO_MS,
    zonaHoraria: ZONA_HORARIA_REGLAS,
  };
}

/** Fecha (AAAA-MM-DD) y hora (0 a 23) de `ahora` en la zona dada. */
export function fechaYHoraLocal(
  ahora: Date,
  zonaHoraria: string,
): { fecha: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (tipo: string) =>
    partes.find((p) => p.type === tipo)?.value ?? '00';
  return {
    fecha: `${valor('year')}-${valor('month')}-${valor('day')}`,
    hora: Number(valor('hour')),
  };
}

/**
 * Si toca recalcular: ya pasó la hora del día y ese día (en la zona del
 * local) todavía no se recalculó. Devuelve la fecha local, para recordarla.
 */
export function tocaRecalcular(
  ahora: Date,
  configuracion: Pick<ConfiguracionReglasComplemento, 'hora' | 'zonaHoraria'>,
  ultimaFecha: string | null,
): { toca: boolean; fecha: string } {
  const { fecha, hora } = fechaYHoraLocal(ahora, configuracion.zonaHoraria);
  return { toca: hora >= configuracion.hora && fecha !== ultimaFecha, fecha };
}
