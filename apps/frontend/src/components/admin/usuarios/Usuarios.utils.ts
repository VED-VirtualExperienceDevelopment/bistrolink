/**
 * BL-361: cómo se nombra a cada usuario en la pantalla de Usuarios, y la
 * validación de nombre y apellido del alta. Lógica pura, sin React, para
 * testearla con Jest en entorno node (mismo criterio que usuario-sesion.utils).
 */
import type { RolListado, Usuario } from "@/types/usuario";

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

// ── BL-363: búsqueda y filtros del listado ──────────────────────────────────
// Se filtra en el navegador: un restaurante tiene pocos usuarios.

export type FiltroRol = "TODOS" | RolListado;
export type FiltroEstado = "ACTIVOS" | "INACTIVOS" | "TODOS";

export interface FiltrosUsuarios {
  busqueda: string;
  rol: FiltroRol;
  estado: FiltroEstado;
}

/** Por defecto se ven los activos: los desactivados se buscan a propósito. */
export const FILTROS_INICIALES: FiltrosUsuarios = {
  busqueda: "",
  rol: "TODOS",
  estado: "ACTIVOS",
};

/**
 * Texto para comparar sin distinguir mayúsculas ni tildes: «Pérez» y
 * «perez» quedan iguales. NFD separa la letra de su tilde y el reemplazo
 * borra las tildes sueltas; la ñ también pasa a n, que para buscar alcanza.
 */
export function normalizarParaBuscar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

/** Busca en el usuario, el nombre, el apellido, el nombre completo y el correo. */
function coincideBusqueda(usuario: Usuario, busqueda: string): boolean {
  const termino = normalizarParaBuscar(busqueda);
  if (!termino) return true;
  return [
    usuario.username,
    usuario.nombre,
    usuario.apellido,
    nombreCompleto(usuario),
    usuario.email,
  ].some((campo) => campo && normalizarParaBuscar(campo).includes(termino));
}

/** Usuarios que cumplen la búsqueda y los dos filtros a la vez. */
export function filtrarUsuarios(
  usuarios: Usuario[],
  filtros: FiltrosUsuarios,
): Usuario[] {
  return usuarios.filter(
    (usuario) =>
      (filtros.rol === "TODOS" || usuario.rol === filtros.rol) &&
      (filtros.estado === "TODOS" ||
        (filtros.estado === "ACTIVOS") === usuario.activo) &&
      coincideBusqueda(usuario, filtros.busqueda),
  );
}

/** Si hay algo distinto de los filtros iniciales (para ofrecer «Limpiar filtros»). */
export function hayFiltrosActivos(filtros: FiltrosUsuarios): boolean {
  return (
    filtros.busqueda.trim() !== "" ||
    filtros.rol !== FILTROS_INICIALES.rol ||
    filtros.estado !== FILTROS_INICIALES.estado
  );
}

/** «1 usuario», «3 usuarios»: lo que se anuncia al lector de pantalla. */
export function textoCantidadUsuarios(cantidad: number): string {
  return cantidad === 1 ? "1 usuario" : `${cantidad} usuarios`;
}

// ── BL-368: último ingreso ──────────────────────────────────────────────────

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

// numeric "always": «hace 2 días» y no «anteayer», como pide la HU.
const RELATIVO = new Intl.RelativeTimeFormat("es", { numeric: "always" });

export interface TextoUltimoIngreso {
  /** Lo que se ve: «Último ingreso: hace 2 días». */
  texto: string;
  /** Fecha y hora completas (title y lector de pantalla), o undefined. */
  completo?: string;
}

/**
 * Texto del último ingreso, o `null` si no hay que mostrar nada (el backend
 * no pudo leer los eventos de Keycloak). `ahora` y `zonaHoraria` se pueden
 * pasar para que los tests no dependan del reloj ni de la zona de la PC.
 */
export function textoUltimoIngreso(
  ultimoIngreso: string | null | undefined,
  ahora: number = Date.now(),
  zonaHoraria?: string,
): TextoUltimoIngreso | null {
  if (ultimoIngreso === undefined) return null;
  if (ultimoIngreso === null) return { texto: "Sin ingresos recientes" };

  const fecha = new Date(ultimoIngreso);
  if (Number.isNaN(fecha.getTime())) return null;

  // Un reloj apenas adelantado no puede dar «dentro de 1 minuto».
  const atras = Math.max(0, ahora - fecha.getTime());
  let relativo: string;
  if (atras < MINUTO) relativo = "hace un momento";
  else if (atras < HORA)
    relativo = RELATIVO.format(-Math.floor(atras / MINUTO), "minute");
  else if (atras < DIA)
    relativo = RELATIVO.format(-Math.floor(atras / HORA), "hour");
  else relativo = RELATIVO.format(-Math.floor(atras / DIA), "day");

  const completo = new Intl.DateTimeFormat("es-AR", {
    dateStyle: "long",
    timeStyle: "short",
    hourCycle: "h23", // «10:30», no «10:30 a. m.»
    timeZone: zonaHoraria,
  }).format(fecha);

  return { texto: `Último ingreso: ${relativo}`, completo };
}
