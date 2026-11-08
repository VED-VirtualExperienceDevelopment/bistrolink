/**
 * HU-009 (BL-455): parámetros de la consulta del estado de los CFE ante la
 * DGI, desde variables de entorno. Mismo criterio que la conciliación de
 * pagos (configuracion-conciliacion.ts).
 *
 * - CFE_ESTADO_DGI_HABILITADA: «false» apaga el job. En los tests
 *   (NODE_ENV=test) está apagado salvo que se habilite a propósito: los tests
 *   de integración llaman al servicio directamente.
 * - CFE_ESTADO_DGI_INTERVALO_MIN (10): cada cuánto corre el job.
 * - CFE_ESTADO_DGI_DIAS (7): se consulta un CFE PENDIENTE emitido en los
 *   últimos N días. Después se deja de consultar y queda para la
 *   conciliación de CFE (HU-023).
 * - CFE_ESTADO_DGI_MAX_POR_CORRIDA (100) y CFE_ESTADO_DGI_PAUSA_MS (500):
 *   con la API v2 de Surtec (BL-471) se consulta un CFE por llamada. Por
 *   corrida y por establecimiento se consultan como máximo N, los más
 *   nuevos primero, con una pausa entre llamadas para no pasar el límite de
 *   Surtec (120 consultas por minuto). En los tests la pausa es 0.
 */
export interface ConfiguracionEstadoDgi {
  habilitada: boolean;
  intervaloMs: number;
  dias: number;
  maxPorCorrida: number;
  pausaMs: number;
}

const MINUTO_MS = 60_000;

/** Entero desde `minimo`; vacío o inválido, el valor por defecto. */
function entero(
  valor: string | undefined,
  porDefecto: number,
  minimo = 1,
): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= minimo ? numero : porDefecto;
}

export function configuracionEstadoDgi(
  env: NodeJS.ProcessEnv,
): ConfiguracionEstadoDgi {
  const valor = env.CFE_ESTADO_DGI_HABILITADA?.trim().toLowerCase();
  return {
    habilitada: env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false',
    intervaloMs: entero(env.CFE_ESTADO_DGI_INTERVALO_MIN, 10) * MINUTO_MS,
    dias: entero(env.CFE_ESTADO_DGI_DIAS, 7),
    maxPorCorrida: entero(env.CFE_ESTADO_DGI_MAX_POR_CORRIDA, 100),
    pausaMs: entero(
      env.CFE_ESTADO_DGI_PAUSA_MS,
      env.NODE_ENV === 'test' ? 0 : 500,
      0,
    ),
  };
}
