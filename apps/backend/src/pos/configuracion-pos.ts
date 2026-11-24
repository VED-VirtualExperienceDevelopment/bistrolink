/**
 * HU-011 (BL-488): parámetros de la sincronización con el POS del local,
 * desde variables de entorno. Mismo criterio que la conciliación de CFE.
 *
 * - POS_ADAPTER: «mock» (por defecto), «http» o «deshabilitado». En los tests
 *   (NODE_ENV=test) el job está apagado salvo POS_SINCRONIZACION_HABILITADA.
 * - POS_API_URL y POS_API_TOKEN: solo con «http». La URL tiene que ser HTTPS
 *   (en local y en los tests se admite http://localhost). El token es un
 *   secreto: va en Infisical o en Railway, nunca en el código.
 * - POS_MOCK_DISPONIBLE: «false» simula el POS caído (para la demo y las
 *   pruebas de tolerancia a fallos).
 * - POS_SINCRONIZACION_INTERVALO_SEG (60): cada cuánto corre el job.
 * - POS_SINCRONIZACION_MAX_INTENTOS (10): después de N fallos queda con
 *   error y el administrador la reintenta desde el panel.
 * - POS_SINCRONIZACION_LOTE (20): máximo de envíos por establecimiento en
 *   cada corrida.
 * - POS_TIMEOUT_MS (5000): espera máxima de cada llamada al POS (el criterio
 *   es registrar la venta en menos de 5 s).
 */
export type TipoAdaptadorPos = 'mock' | 'http' | 'deshabilitado';

export interface ConfiguracionPos {
  adaptador: TipoAdaptadorPos;
  apiUrl: string | null;
  apiToken: string | null;
  mockDisponible: boolean;
  jobHabilitado: boolean;
  intervaloMs: number;
  maxIntentos: number;
  lote: number;
  timeoutMs: number;
}

function entero(valor: string | undefined, porDefecto: number): number {
  if (valor === undefined || valor.trim() === '') return porDefecto;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}

function texto(valor: string | undefined): string | null {
  const limpio = valor?.trim();
  // Vacío o solo espacios cuenta como no configurado.
  if (!limpio) return null;
  return limpio;
}

function tipoAdaptador(valor: string | undefined): TipoAdaptadorPos {
  const limpio = valor?.trim().toLowerCase();
  return limpio === 'http' || limpio === 'deshabilitado' ? limpio : 'mock';
}

/**
 * La URL del POS tiene que ser HTTPS (HU-011, [S]). http solo contra
 * localhost, para el contrato PactJS y el desarrollo local.
 */
export function urlPosValida(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'https:') return true;
    return (
      protocol === 'http:' &&
      (hostname === 'localhost' || hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

export function configuracionPos(env: NodeJS.ProcessEnv): ConfiguracionPos {
  const habilitado = env.POS_SINCRONIZACION_HABILITADA?.trim().toLowerCase();
  return {
    adaptador: tipoAdaptador(env.POS_ADAPTER),
    apiUrl: texto(env.POS_API_URL),
    apiToken: texto(env.POS_API_TOKEN),
    mockDisponible: env.POS_MOCK_DISPONIBLE?.trim().toLowerCase() !== 'false',
    jobHabilitado:
      env.NODE_ENV === 'test' ? habilitado === 'true' : habilitado !== 'false',
    intervaloMs: entero(env.POS_SINCRONIZACION_INTERVALO_SEG, 60) * 1000,
    maxIntentos: entero(env.POS_SINCRONIZACION_MAX_INTENTOS, 10),
    lote: entero(env.POS_SINCRONIZACION_LOTE, 20),
    timeoutMs: entero(env.POS_TIMEOUT_MS, 5000),
  };
}
