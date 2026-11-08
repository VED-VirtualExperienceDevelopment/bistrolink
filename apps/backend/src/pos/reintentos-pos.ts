/**
 * HU-011 (BL-488): cuándo se reintenta mandar una venta al POS.
 *
 * - Recién encolada: el envío inmediato (después del commit) ya la está
 *   mandando. El job la toma recién después de ESPERA_INICIAL_MS, para no
 *   mandarla dos veces a la vez.
 * - Después de cada intento fallido, la espera crece: 1 min, 5 min, 15 min,
 *   1 h y después cada 6 h. Un POS caído no recibe una ráfaga al volver.
 */
const MINUTO_MS = 60_000;

export const ESPERA_INICIAL_MS = 30_000;
export const ESPERAS_ENTRE_INTENTOS_MS = [
  1 * MINUTO_MS,
  5 * MINUTO_MS,
  15 * MINUTO_MS,
  60 * MINUTO_MS,
  6 * 60 * MINUTO_MS,
] as const;

export interface EnvioPos {
  createdAt: Date;
  intentos: number;
  ultimoIntentoEn: Date | null;
}

/** Cuánto esperar después del último intento, según cuántos fallaron. */
export function esperaDespuesDe(intentos: number): number {
  if (intentos <= 0) return 0;
  const indice = Math.min(intentos, ESPERAS_ENTRE_INTENTOS_MS.length) - 1;
  return ESPERAS_ENTRE_INTENTOS_MS[indice];
}

/** Cuándo le toca el próximo intento automático. */
export function proximoIntentoPos(envio: EnvioPos): Date {
  if (!envio.ultimoIntentoEn) {
    return new Date(envio.createdAt.getTime() + ESPERA_INICIAL_MS);
  }
  return new Date(
    envio.ultimoIntentoEn.getTime() + esperaDespuesDe(envio.intentos),
  );
}

export function tocaReintentarPos(envio: EnvioPos, ahora: Date): boolean {
  return proximoIntentoPos(envio).getTime() <= ahora.getTime();
}
