import {
  nombreComensalTecnico,
  PREFIJO_COMENSAL_TECNICO,
} from './nombre-comensal-tecnico';

/**
 * BL-271 (parte 3): plan para pasar los usuarios técnicos del comensal del
 * nombre anterior (`comensal-<tenantId>`) al nombre calculado con
 * KEYCLOAK_COMENSAL_USERNAME_SECRET. Lo usa
 * `scripts/migrar-comensal-tecnico.ts`; acá queda solo la lógica sin red,
 * para poder probarla.
 */

/** Lo que devuelve la Admin API de Keycloak de cada usuario. */
export interface UsuarioKeycloak {
  id: string;
  username: string;
  attributes?: Record<string, string[] | undefined>;
}

export interface PasoMigracion {
  tenantId: string;
  /** Usuario con el nombre anterior (`comensal-<tenantId>`). */
  anterior: { id: string; username: string };
  /** Nombre nuevo, calculado con el secreto. */
  nuevo: string;
  /** Id del usuario nuevo si ya existe en Keycloak. */
  nuevoId?: string;
  /**
   * El atributo `tenant_id` del usuario anterior no coincide con su nombre.
   * No se migra: hay que revisarlo a mano.
   */
  inconsistente: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * El tenantId de un usuario con el nombre anterior, o null si el nombre no
 * es `comensal-<uuid>` (por ejemplo, uno que ya tiene el nombre nuevo).
 * Keycloak guarda los usernames en minúscula.
 */
export function tenantDeNombreAnterior(username: string): string | null {
  if (!username.startsWith(PREFIJO_COMENSAL_TECNICO)) return null;
  const resto = username.slice(PREFIJO_COMENSAL_TECNICO.length).toLowerCase();
  return UUID.test(resto) ? resto : null;
}

/**
 * Un paso por cada usuario con el nombre anterior: qué nombre nuevo le
 * corresponde y si ese usuario ya existe. Los usuarios que no tienen el
 * nombre anterior no generan pasos.
 */
export function planDeMigracion(
  usuarios: readonly UsuarioKeycloak[],
  secreto: string,
): PasoMigracion[] {
  if (!secreto) {
    throw new Error('Falta el secreto: sin él, el nombre nuevo es el anterior');
  }
  const idPorNombre = new Map(usuarios.map((u) => [u.username, u.id]));
  const pasos: PasoMigracion[] = [];
  for (const usuario of usuarios) {
    const tenantId = tenantDeNombreAnterior(usuario.username);
    if (!tenantId) continue;
    const atributo = usuario.attributes?.tenant_id?.[0];
    const nuevo = nombreComensalTecnico(tenantId, secreto);
    pasos.push({
      tenantId,
      anterior: { id: usuario.id, username: usuario.username },
      nuevo,
      nuevoId: idPorNombre.get(nuevo),
      inconsistente: atributo !== undefined && atributo !== tenantId,
    });
  }
  return pasos.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
}
