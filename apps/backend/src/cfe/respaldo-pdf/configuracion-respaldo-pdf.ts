/**
 * HU-009 (BL-454): parámetros del respaldo del PDF de los CFE en S3, desde
 * variables de entorno. Mismo criterio que la conciliación de CFE (BL-96).
 *
 * - CFE_RESPALDO_PDF_HABILITADO: «false» apaga el job. En los tests
 *   (NODE_ENV=test) está apagado salvo que se habilite a propósito. Sin
 *   S3_BUCKET_CFE no hace nada.
 * - CFE_RESPALDO_PDF_INTERVALO_MIN (5): cada cuánto corre el job.
 * - CFE_RESPALDO_PDF_DIAS (7): se guardan los CFE emitidos en los últimos N
 *   días. Para guardar los anteriores, se sube por un rato.
 * - CFE_RESPALDO_PDF_MAX_INTENTOS (10): después de N fallos se deja de
 *   intentar (queda en el log; el PDF se sigue pidiendo a Surtec).
 * - CFE_RESPALDO_PDF_LOTE (20): máximo de comprobantes por establecimiento
 *   en cada corrida. Surtec admite 120 consultas por minuto.
 */
export interface ConfiguracionRespaldoPdf {
  habilitado: boolean;
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

export function configuracionRespaldoPdf(
  env: NodeJS.ProcessEnv,
): ConfiguracionRespaldoPdf {
  const valor = env.CFE_RESPALDO_PDF_HABILITADO?.trim().toLowerCase();
  return {
    habilitado: env.NODE_ENV === 'test' ? valor === 'true' : valor !== 'false',
    intervaloMs:
      enteroPositivo(env.CFE_RESPALDO_PDF_INTERVALO_MIN, 5) * MINUTO_MS,
    dias: enteroPositivo(env.CFE_RESPALDO_PDF_DIAS, 7),
    maxIntentos: enteroPositivo(env.CFE_RESPALDO_PDF_MAX_INTENTOS, 10),
    lote: enteroPositivo(env.CFE_RESPALDO_PDF_LOTE, 20),
  };
}
