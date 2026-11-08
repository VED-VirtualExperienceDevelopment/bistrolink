/**
 * HU-023 (BL-96): parámetros de la conciliación de CFE pendientes, desde
 * variables de entorno. Mismo criterio que la conciliación de pagos.
 *
 * - CFE_CONCILIACION_HABILITADA: «false» apaga el job. En los tests
 *   (NODE_ENV=test) está apagado salvo que se habilite a propósito.
 * - CFE_CONCILIACION_INTERVALO_MIN (5): cada cuánto corre el job.
 * - CFE_CONCILIACION_DIAS (3): se reintenta solo un pago aprobado en los
 *   últimos N días. Después queda «requiere atención».
 * - CFE_CONCILIACION_MAX_INTENTOS (10): después de N intentos fallidos
 *   también queda «requiere atención» (el administrador puede reintentar).
 * - CFE_CONCILIACION_LOTE (20): máximo de pagos por establecimiento en cada
 *   corrida.
 */
export interface ConfiguracionConciliacionCfe {
  habilitada: boolean;
  intervaloMs: number;
  dias: number;
  maxIntentos: number;
  lote: number;
}

const MINUTO_MS = 60_000;

function enteroPositivo(valor: string | undefined, porDefecto: number): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}

export function configuracionConciliacionCfe(
  env: NodeJS.ProcessEnv,
): ConfiguracionConciliacionCfe {
  const valor = env.CFE_CONCILIACION_HABILITADA?.trim().toLowerCase();
  return {
    habilitada: env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false',
    intervaloMs:
      enteroPositivo(env.CFE_CONCILIACION_INTERVALO_MIN, 5) * MINUTO_MS,
    dias: enteroPositivo(env.CFE_CONCILIACION_DIAS, 3),
    maxIntentos: enteroPositivo(env.CFE_CONCILIACION_MAX_INTENTOS, 10),
    lote: enteroPositivo(env.CFE_CONCILIACION_LOTE, 20),
  };
}
