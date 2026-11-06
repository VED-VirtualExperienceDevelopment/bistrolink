/**
 * BL-285 (ADR 0011): lo que la limpieza considera «del seed» o «de los E2E».
 *
 * Mantener alineado con `prisma/seed.ts` y con `e2e/support/`: si el seed o
 * un E2E cambian estos datos, la limpieza tiene que cambiar con ellos (es
 * una de las consecuencias del ADR 0011).
 */

/**
 * Mesas de salón del seed (tenant A). El seed las deja ABIERTAS (OCUPADA,
 * con sesión) a propósito: los QR de los E2E las usan para pedir sin pasar
 * por el mozo. La limpieza las deja igual.
 */
export const MESAS_DEL_SEED: readonly string[] = [
  '33333333-3333-3333-3333-333333333333', // mesa 1
  '33333333-3333-3333-3333-333333333334', // mesa 2 (llamado-mozo.spec.ts)
];

/**
 * Mesas temporales de los E2E (`e2e/support/mesa-temporal.ts`): número al
 * azar entre 50 y 99. Se eliminan si no tienen pedidos.
 */
export const NUMERO_MESA_TEMPORAL_MINIMO = 50;
export const NUMERO_MESA_TEMPORAL_MAXIMO = 99;

/** Zonas del plano creadas por `plano-salon.spec.ts` («Zona E2E 12345»). */
export const PREFIJO_ZONA_E2E = 'Zona E2E';
