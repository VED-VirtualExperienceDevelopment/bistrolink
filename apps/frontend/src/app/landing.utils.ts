// Lógica pura de "/" separada del componente (page.tsx) a propósito, mismo
// criterio que mapa-mesas.utils.ts: page.tsx depende de useKeycloakAuth (un
// hook con estado de red/SDK real) y de next/navigation, ninguno de los dos
// fácil de montar en un test sin jsdom + React Testing Library — infra que
// este workspace todavía no tiene (ver el comentario de testEnvironment en
// jest.config.js). Lo que sí vale la pena cubrir con un test rápido es la
// decisión en sí (qué ruta gana según los roles), así que vive acá como una
// función pura sin dependencia de React ni de Keycloak.

/** Roles de staff reconocidos por la landing. Cualquier otro rol (o ninguno) cae en "sin acceso". */
export type RolStaff = 'ADMIN' | 'MOZO' | 'COCINA';

/**
 * Decide a qué ruta redirige "/" para un usuario ya autenticado.
 *
 * Prioridad ADMIN > MOZO > COCINA cuando el usuario tiene más de un rol
 * (ej. un ADMIN que también es MOZO) — cada uno va a su pantalla operativa
 * principal ya existente. Devuelve null si no tiene ninguno de los 3 roles
 * de staff, caso en el que page.tsx muestra el mensaje de "sin acceso" en
 * vez de redirigir (evita un loop con /login).
 */
export function resolverDestinoLanding(hasRole: (rol: RolStaff) => boolean): string | null {
  if (hasRole('ADMIN')) return '/admin/usuarios';
  if (hasRole('MOZO')) return '/admin/mesas';
  if (hasRole('COCINA')) return '/kds';
  return null;
}

/** true si el usuario tiene al menos uno de los 3 roles de staff reconocidos por la landing. */
export function esRolDeStaff(hasRole: (rol: RolStaff) => boolean): boolean {
  return hasRole('ADMIN') || hasRole('MOZO') || hasRole('COCINA');
}