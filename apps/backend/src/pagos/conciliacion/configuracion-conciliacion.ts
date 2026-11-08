/**
 * HU-032 (BL-202): parámetros del vencimiento y la conciliación de pagos
 * pendientes, desde variables de entorno.
 *
 * - PAGOS_CONCILIACION_HABILITADA: «false» apaga el job. En los tests
 *   (NODE_ENV=test) está apagado salvo que se habilite a propósito: los tests
 *   de integración llaman al servicio directamente.
 * - PAGOS_CONCILIACION_INTERVALO_SEG (60): cada cuánto corre el job.
 * - PAGOS_CONCILIAR_DESPUES_MIN (2): un pago PENDIENTE con más de esto sin
 *   resolverse se le consulta a la pasarela. Antes de eso, lo normal es que
 *   el webhook llegue solo.
 * - PAGOS_VENCER_DESPUES_MIN (15): un pago PENDIENTE con más de esto sin
 *   confirmación vence (RECHAZADO, motivo VENCIDO). El criterio de HU-032
 *   pide que sea configurable por establecimiento (HU-020): hasta que exista
 *   esa configuración, vale para todos.
 * - PAGOS_CONCILIACION_LOTE (50): máximo de pagos por establecimiento en
 *   cada corrida, para que una corrida no se alargue sin límite.
 */
export interface ConfiguracionConciliacion {
  habilitada: boolean;
  intervaloMs: number;
  conciliarDespuesMs: number;
  vencerDespuesMs: number;
  lote: number;
}

const SEGUNDO_MS = 1000;
const MINUTO_MS = 60 * SEGUNDO_MS;

function enteroPositivo(valor: string | undefined, porDefecto: number): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}

export function configuracionConciliacion(
  env: NodeJS.ProcessEnv,
): ConfiguracionConciliacion {
  const valor = env.PAGOS_CONCILIACION_HABILITADA?.trim().toLowerCase();
  const habilitada =
    env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false';

  const conciliarDespuesMs =
    enteroPositivo(env.PAGOS_CONCILIAR_DESPUES_MIN, 2) * MINUTO_MS;
  // Vencer antes de consultar no tendría sentido: se consulta primero.
  const vencerDespuesMs = Math.max(
    enteroPositivo(env.PAGOS_VENCER_DESPUES_MIN, 15) * MINUTO_MS,
    conciliarDespuesMs,
  );

  return {
    habilitada,
    intervaloMs:
      enteroPositivo(env.PAGOS_CONCILIACION_INTERVALO_SEG, 60) * SEGUNDO_MS,
    conciliarDespuesMs,
    vencerDespuesMs,
    lote: enteroPositivo(env.PAGOS_CONCILIACION_LOTE, 50),
  };
}
