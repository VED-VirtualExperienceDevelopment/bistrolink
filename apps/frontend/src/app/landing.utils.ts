// Lógica pura de "/" separada del componente (page.tsx) a propósito, mismo
// criterio que mapa-mesas.utils.ts: page.tsx depende de useKeycloakAuth (un
// hook con estado de red/SDK real) y de next/navigation, ninguno de los dos
// fácil de montar en un test sin jsdom + React Testing Library — infra que
// este workspace todavía no tiene (ver el comentario de testEnvironment en
// jest.config.js). Lo que sí vale la pena cubrir con un test rápido es la
// decisión en sí (qué ruta gana según los roles), así que vive acá como una
// función pura sin dependencia de React ni de Keycloak.

/**
 * Roles con pantalla propia reconocidos por la landing. Cualquier otro rol (o
 * ninguno) cae en "sin acceso". PLATAFORMA (BL-163) no es staff de un
 * restaurante sino del equipo de BistroLink, pero entra igual por /login.
 */
export type RolStaff = "ADMIN" | "MOZO" | "COCINA" | "PLATAFORMA";

/**
 * Decide a qué ruta redirige "/" para un usuario ya autenticado.
 *
 * Prioridad PLATAFORMA > ADMIN > MOZO > COCINA cuando el usuario tiene más
 * de un rol (ej. un ADMIN que también es MOZO) — cada uno va a su pantalla
 * operativa principal ya existente. PLATAFORMA va primero porque su token no
 * sirve en ninguna pantalla de un restaurante (BL-163): mandarlo a
 * /admin/usuarios terminaría en 401. Devuelve null si no tiene ninguno de
 * los roles reconocidos, caso en el que page.tsx muestra el mensaje de "sin
 * acceso" en vez de redirigir (evita un loop con /login).
 */
export function resolverDestinoLanding(
  hasRole: (rol: RolStaff) => boolean,
): string | null {
  if (hasRole("PLATAFORMA")) return "/plataforma";
  if (hasRole("ADMIN")) return "/admin/usuarios";
  if (hasRole("MOZO")) return "/admin/mesas";
  if (hasRole("COCINA")) return "/kds";
  return null;
}

/** true si el usuario tiene al menos uno de los roles reconocidos por la landing (incluido PLATAFORMA). */
export function esRolDeStaff(hasRole: (rol: RolStaff) => boolean): boolean {
  return (
    hasRole("PLATAFORMA") ||
    hasRole("ADMIN") ||
    hasRole("MOZO") ||
    hasRole("COCINA")
  );
}
