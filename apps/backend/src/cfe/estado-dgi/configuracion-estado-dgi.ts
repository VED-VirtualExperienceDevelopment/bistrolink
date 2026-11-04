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
 */
export interface ConfiguracionEstadoDgi {
  habilitada: boolean;
  intervaloMs: number;
  dias: number;
}

const MINUTO_MS = 60_000;

function enteroPositivo(valor: string | undefined, porDefecto: number): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}

export function configuracionEstadoDgi(
  env: NodeJS.ProcessEnv,
): ConfiguracionEstadoDgi {
  const valor = env.CFE_ESTADO_DGI_HABILITADA?.trim().toLowerCase();
  return {
    habilitada: env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false',
    intervaloMs:
      enteroPositivo(env.CFE_ESTADO_DGI_INTERVALO_MIN, 10) * MINUTO_MS,
    dias: enteroPositivo(env.CFE_ESTADO_DGI_DIAS, 7),
  };
}
