// BL-517: lógica pura de la página de error (error.tsx), separada del
// componente con el mismo criterio que landing.utils.ts: se testea sin jsdom.

/**
 * Marca en sessionStorage con la hora de la última recarga automática. Evita
 * un loop si después de recargar el chunk sigue sin cargar.
 */
export const CLAVE_RECARGA_POR_VERSION = "bistrolink:recarga-por-version";

/** Tiempo mínimo entre dos recargas automáticas. */
export const ESPERA_ENTRE_RECARGAS_MS = 60_000;

/**
 * Espera antes de recargar, para que Faro alcance a mandar el error y el
 * usuario vea el aviso en lugar de un parpadeo.
 */
export const DEMORA_ANTES_DE_RECARGAR_MS = 1_000;

/**
 * Un deploy reemplaza los chunks de JavaScript. Una pestaña abierta desde
 * antes pide los viejos y falla: webpack lanza un ChunkLoadError con el
 * mensaje «Loading chunk N failed» (o «Loading CSS chunk N failed»).
 */
export function esErrorDeChunk(
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  return /Loading (CSS )?chunk [\w-]+ failed/i.test(error.message ?? "");
}

/**
 * Si se puede recargar sola: no hubo otra recarga automática en los últimos
 * `ESPERA_ENTRE_RECARGAS_MS`. `ultimaRecarga` es el valor guardado en
 * sessionStorage (null si no hay, o un valor que no es un número).
 */
export function puedeRecargar(
  ahora: number,
  ultimaRecarga: string | null,
): boolean {
  const ultima = Number(ultimaRecarga);
  if (!ultimaRecarga || !Number.isFinite(ultima)) return true;
  return ahora - ultima >= ESPERA_ENTRE_RECARGAS_MS;
}

/**
 * Texto que explica el error según su tipo y si ya se está recargando.
 * Separado del JSX para no anidar ternarios (regla de SonarCloud).
 */
export function mensajeDeError(
  deVersion: boolean,
  recargando: boolean,
): string {
  if (!deVersion) {
    return "Probá de nuevo. Si el problema sigue, avisale al personal del local.";
  }
  if (recargando) {
    return "Recargando la página…";
  }
  return "Recargá la página para seguir. Tu pedido confirmado y tu pago en curso no se pierden.";
}
