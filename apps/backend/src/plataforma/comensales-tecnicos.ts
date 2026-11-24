/**
 * BL-581: qué usuarios de Keycloak son comensales técnicos que quedaron de
 * antes de HU-052 y se pueden borrar.
 *
 * Desde HU-052 la API le emite al comensal su propio token de invitado y no
 * usa ningún usuario de Keycloak (ADR 0014). Los comensales técnicos que se
 * crearon antes (uno por establecimiento, BL-163 y BL-271) ya no sirven.
 *
 * Se borra un usuario solo si cumple las tres condiciones, para no tocar
 * nunca una cuenta del personal por error:
 * - tiene el rol COMENSAL (quien llama lo trae de /roles/COMENSAL/users);
 * - su nombre empieza con `comensal-` (el prefijo de BL-163 y BL-271);
 * - no tiene ningún otro rol del establecimiento ni de la plataforma.
 */

export const PREFIJO_COMENSAL_TECNICO = 'comensal-';

/** Roles que nunca tiene un comensal técnico. */
export const ROLES_DEL_PERSONAL = ['ADMIN', 'MOZO', 'COCINA', 'PLATAFORMA'];

export interface UsuarioConRoles {
  id: string;
  username: string;
  tenantId?: string;
  /** Roles de realm del usuario. */
  roles: string[];
}

export interface PlanDeBorrado {
  borrar: UsuarioConRoles[];
  /** Tienen el rol COMENSAL pero no cumplen las otras condiciones. */
  revisarAMano: UsuarioConRoles[];
}

export function comensalesTecnicosABorrar(
  usuarios: UsuarioConRoles[],
): PlanDeBorrado {
  const borrar: UsuarioConRoles[] = [];
  const revisarAMano: UsuarioConRoles[] = [];
  for (const usuario of usuarios) {
    const tieneRolDelPersonal = usuario.roles.some((rol) =>
      ROLES_DEL_PERSONAL.includes(rol),
    );
    const esTecnico =
      usuario.username.startsWith(PREFIJO_COMENSAL_TECNICO) &&
      usuario.roles.includes('COMENSAL') &&
      !tieneRolDelPersonal;
    (esTecnico ? borrar : revisarAMano).push(usuario);
  }
  return { borrar, revisarAMano };
}
