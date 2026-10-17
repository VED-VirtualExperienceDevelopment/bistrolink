/**
 * BL-349: qué se muestra de la persona que inició sesión, a partir de los
 * claims del scope `profile` del token (BL-344). Es lógica pura, sin React,
 * para poder testearla con Jest en entorno node.
 *
 * El correo no se lee a propósito: el token no lo trae (BL-344) y la UI no
 * lo muestra, porque las tablets del salón y de la caja son compartidas.
 */

/** Claims del token que la app usa para identificar a la persona. */
export interface ClaimsPerfil {
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
}

/** Lo que la app muestra de quien inició sesión. */
export interface UsuarioSesion {
  /** Usuario de Keycloak (`preferred_username`), por ejemplo «ana.perez». */
  nombreUsuario: string | undefined;
  /** Nombre completo. Si el token no lo trae, el usuario. */
  nombre: string | undefined;
  /** Una o dos letras para el círculo del encabezado. */
  iniciales: string;
  /** Rol principal en español, por ejemplo «Administrador». */
  rol: string | undefined;
}

/**
 * Roles del personal en orden de prioridad: si alguien tiene más de uno, se
 * muestra el primero de esta lista. COMENSAL no figura porque no entra a las
 * pantallas del personal.
 */
const NOMBRES_ROL: ReadonlyArray<readonly [string, string]> = [
  ["PLATAFORMA", "Plataforma"],
  ["ADMIN", "Administrador"],
  ["MOZO", "Mozo"],
  ["COCINA", "Cocina"],
];

/** Texto sin espacios de más, o `undefined` si queda vacío. */
function limpiar(texto: string | undefined): string | undefined {
  const limpio = texto?.trim().replace(/\s+/g, " ");
  return limpio || undefined;
}

/** Nombre completo: `name` y, si no está, nombre y apellido. */
export function nombreCompleto(claims: ClaimsPerfil): string | undefined {
  return (
    limpiar(claims.name) ??
    limpiar([claims.given_name, claims.family_name].filter(Boolean).join(" "))
  );
}

/** Primera letra en mayúscula (respeta tildes y caracteres compuestos). */
function primeraLetra(palabra: string): string {
  return (Array.from(palabra)[0] ?? "").toLocaleUpperCase("es");
}

/**
 * Iniciales: primera letra de la primera y de la última palabra.
 * «Ana María Pérez» → «AP». Sin nombre, salen del usuario: «ana.perez» → «AP».
 * Si no hay nada, «?».
 */
export function iniciales(
  nombre: string | undefined,
  nombreUsuario: string | undefined,
): string {
  const palabras =
    limpiar(nombre)?.split(" ") ??
    limpiar(nombreUsuario)
      ?.split(/[.\-_\s]+/)
      .filter(Boolean) ??
    [];
  if (palabras.length === 0) return "?";
  const primera = primeraLetra(palabras[0]);
  if (palabras.length === 1) return primera;
  return primera + primeraLetra(palabras.at(-1) ?? "");
}

/** Rol principal en español, o `undefined` si no tiene un rol del personal. */
export function nombreRol(roles: readonly string[]): string | undefined {
  return NOMBRES_ROL.find(([rol]) => roles.includes(rol))?.[1];
}

/** Arma lo que se muestra de la persona a partir del token. */
export function usuarioSesion(
  claims: ClaimsPerfil | undefined,
  roles: readonly string[],
): UsuarioSesion {
  const nombreUsuario = limpiar(claims?.preferred_username);
  const nombre = (claims && nombreCompleto(claims)) ?? nombreUsuario;
  return {
    nombreUsuario,
    nombre,
    iniciales: iniciales(nombre, nombreUsuario),
    rol: nombreRol(roles),
  };
}
