/**
 * BL-361: cómo se nombra a cada usuario en la pantalla de Usuarios, y la
 * validación de nombre y apellido del alta. Lógica pura, sin React, para
 * testearla con Jest en entorno node (mismo criterio que usuario-sesion.utils).
 */
import type { Usuario } from "@/types/usuario";

/** Nombre y apellido, o `undefined` si el usuario no los tiene cargados. */
export function nombreCompleto(
  usuario: Pick<Usuario, "nombre" | "apellido">,
): string | undefined {
  const completo = [usuario.nombre, usuario.apellido]
    .map((parte) => parte?.trim())
    .filter(Boolean)
    .join(" ");
  return completo || undefined;
}

/**
 * Lo que se muestra como nombre del usuario: el nombre completo; si no lo
 * tiene (usuarios creados antes de BL-361), el usuario; y si tampoco, un
 * identificador corto.
 */
export function nombreParaMostrar(
  usuario: Pick<Usuario, "id" | "nombre" | "apellido" | "username">,
): string {
  return (
    nombreCompleto(usuario) ??
    usuario.username ??
    `Usuario ${usuario.id.slice(0, 8)}`
  );
}

/**
 * Mismo formato que valida el backend (FORMATO_NOMBRE_PERSONA en
 * create-usuario.dto.ts): empieza con una letra y después letras, espacios,
 * apóstrofo, punto o guion.
 */
const FORMATO_NOMBRE_PERSONA = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
export const LARGO_MAXIMO_NOMBRE = 60;

/**
 * Error de un campo de nombre o apellido, o `null` si es válido. Se valida
 * acá para mostrar el mensaje junto al campo, sin esperar al backend.
 */
export function errorNombrePersona(
  valor: string,
  campo: "nombre" | "apellido",
): string | null {
  const limpio = valor.trim().replace(/\s+/g, " ");
  if (!limpio) {
    return campo === "nombre" ? "Ingresá el nombre." : "Ingresá el apellido.";
  }
  if (limpio.length > LARGO_MAXIMO_NOMBRE) {
    return `Puede tener hasta ${LARGO_MAXIMO_NOMBRE} caracteres.`;
  }
  if (!FORMATO_NOMBRE_PERSONA.test(limpio)) {
    return "Usá solo letras, espacios, apóstrofo, punto o guion, empezando con una letra.";
  }
  return null;
}

/** BL-362: la cuenta compartida de la cocina (vive solo en Keycloak). */
export function esCuentaCocina(
  usuario: Pick<Usuario, "rol" | "cuentaCompartida">,
): boolean {
  return usuario.cuentaCompartida === true || usuario.rol === "COCINA";
}

/**
 * BL-362: ruta de la API para las acciones sobre un usuario. La cuenta de
 * cocina no tiene fila en `usuario`: sus acciones van por
 * /usuarios/cocina/:keycloakId (desactivar, reactivar y restablecer).
 */
export function rutaUsuario(
  usuario: Pick<Usuario, "id" | "rol" | "cuentaCompartida">,
): string {
  return esCuentaCocina(usuario)
    ? `/usuarios/cocina/${usuario.id}`
    : `/usuarios/${usuario.id}`;
}
