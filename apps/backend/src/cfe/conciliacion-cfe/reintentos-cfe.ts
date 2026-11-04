/**
 * HU-023 (BL-96): cuándo se reintenta la emisión de un CFE pendiente.
 *
 * - Un pago recién aprobado no se toca durante ESPERA_INICIAL_MS: la
 *   emisión en segundo plano (BL-311) todavía puede estar reintentando.
 * - Después de cada intento fallido, la espera crece: 5 min, 15 min, 1 h y
 *   después cada 6 h. Así un Surtec caído no recibe una ráfaga y un error
 *   que hay que corregir (un 4xx, por ejemplo sin CAE) no se reintenta cada
 *   pocos minutos.
 * - Requiere atención: más de `maxIntentos` fallidos o aprobado hace más de
 *   `dias`. Ya no se reintenta solo; el administrador lo ve y puede
 *   reintentarlo a mano.
 */
const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * MINUTO_MS;

export const ESPERA_INICIAL_MS = 2 * MINUTO_MS;
export const ESPERAS_ENTRE_INTENTOS_MS = [
  5 * MINUTO_MS,
  15 * MINUTO_MS,
  60 * MINUTO_MS,
  6 * 60 * MINUTO_MS,
] as const;

export interface PagoSinCfe {
  createdAt: Date;
  cfeIntentos: number;
  cfeUltimoIntentoEn: Date | null;
}

/** Cuánto esperar después del último intento, según cuántos fallaron. */
export function esperaDespuesDe(intentos: number): number {
  if (intentos <= 0) return 0;
  const indice = Math.min(intentos, ESPERAS_ENTRE_INTENTOS_MS.length) - 1;
  return ESPERAS_ENTRE_INTENTOS_MS[indice];
}

export function requiereAtencion(
  pago: PagoSinCfe,
  limites: { dias: number; maxIntentos: number },
  ahora: Date,
): boolean {
  return (
    pago.cfeIntentos >= limites.maxIntentos ||
    ahora.getTime() - pago.createdAt.getTime() > limites.dias * DIA_MS
  );
}

/** Cuándo toca el próximo intento automático; null si requiere atención. */
export function proximoIntento(
  pago: PagoSinCfe,
  limites: { dias: number; maxIntentos: number },
  ahora: Date,
): Date | null {
  if (requiereAtencion(pago, limites, ahora)) return null;
  const desde = pago.cfeUltimoIntentoEn ?? pago.createdAt;
  const espera = pago.cfeUltimoIntentoEn
    ? esperaDespuesDe(pago.cfeIntentos)
    : ESPERA_INICIAL_MS;
  return new Date(desde.getTime() + espera);
}

export function tocaReintentar(
  pago: PagoSinCfe,
  limites: { dias: number; maxIntentos: number },
  ahora: Date,
): boolean {
  const proximo = proximoIntento(pago, limites, ahora);
  return proximo !== null && proximo.getTime() <= ahora.getTime();
}
