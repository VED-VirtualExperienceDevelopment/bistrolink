// BL-163 (HU-027): lógica pura de la pantalla /plataforma, separada de los
// componentes por el mismo motivo que landing.utils.ts y mapa-mesas.utils.ts:
// se testea con Jest sin DOM ni Keycloak (test/unitarios/plataforma.utils.spec.ts).
//
// Las validaciones calcan las del DTO del backend
// (AprovisionarEstablecimientoDto): el backend sigue siendo quien decide, esto
// solo evita un viaje de ida y vuelta para errores obvios.

import type {
  EstablecimientoListado,
  FormularioAlta,
  ResultadoAlta,
  UsuarioAprovisionado,
} from "@/types/plataforma";

export const FORMULARIO_VACIO: FormularioAlta = {
  razonSocial: "",
  rut: "",
  restauranteNombre: "",
  restauranteDireccion: "",
  adminUsername: "",
  adminEmail: "",
  adminNombre: "",
  adminApellido: "",
  cocinaUsername: "",
  cocinaEmail: "",
};

const FORMATO_RUT = /^\d{12}$/;
const FORMATO_USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MENSAJE_USERNAME =
  "De 3 a 50 caracteres, en minúsculas: letras, números, punto, guion o guion bajo";

/** Errores por campo; un objeto vacío quiere decir que el formulario es válido. */
export type ErroresFormulario = Partial<Record<keyof FormularioAlta, string>>;

export function validarFormulario(f: FormularioAlta): ErroresFormulario {
  const errores: ErroresFormulario = {};
  const requerido = (campo: keyof FormularioAlta, max: number) => {
    const valor = f[campo].trim();
    if (!valor) errores[campo] = "Obligatorio";
    else if (valor.length > max) errores[campo] = `Máximo ${max} caracteres`;
  };

  requerido("razonSocial", 200);
  if (!FORMATO_RUT.test(f.rut.trim())) {
    errores.rut = "Tienen que ser 12 dígitos, sin puntos ni guiones";
  }
  requerido("restauranteNombre", 120);
  requerido("restauranteDireccion", 200);

  for (const campo of ["adminUsername", "cocinaUsername"] as const) {
    const valor = f[campo].trim();
    if (!FORMATO_USERNAME.test(valor)) errores[campo] = MENSAJE_USERNAME;
    else if (valor.startsWith("comensal-")) {
      errores[campo] = 'Los usernames "comensal-…" están reservados';
    }
  }
  if (
    !errores.cocinaUsername &&
    f.adminUsername.trim() === f.cocinaUsername.trim()
  ) {
    errores.cocinaUsername = "Tiene que ser distinto del Administrador";
  }

  if (!FORMATO_EMAIL.test(f.adminEmail.trim())) {
    errores.adminEmail = "Email inválido";
  }
  requerido("adminNombre", 80);
  requerido("adminApellido", 80);
  if (f.cocinaEmail.trim() && !FORMATO_EMAIL.test(f.cocinaEmail.trim())) {
    errores.cocinaEmail = "Email inválido";
  }

  return errores;
}

/**
 * Body de POST /plataforma/establecimientos. Sin tenantId, plan ni timezone:
 * el backend usa los valores por defecto (BASICO, America/Montevideo) y busca
 * el tenant por RUT. Sin contraseñas: el backend las genera.
 */
export function construirPedidoAlta(f: FormularioAlta) {
  const cocinaEmail = f.cocinaEmail.trim();
  return {
    razonSocial: f.razonSocial.trim(),
    rut: f.rut.trim(),
    restaurante: {
      nombre: f.restauranteNombre.trim(),
      direccion: f.restauranteDireccion.trim(),
    },
    admin: {
      username: f.adminUsername.trim(),
      email: f.adminEmail.trim(),
      nombre: f.adminNombre.trim(),
      apellido: f.adminApellido.trim(),
    },
    cocina: {
      username: f.cocinaUsername.trim(),
      ...(cocinaEmail ? { email: cocinaEmail } : {}),
    },
  };
}

/** Usuarios con contraseña temporal para mostrar (una sola vez). */
export function credencialesAMostrar(
  resultado: ResultadoAlta,
): UsuarioAprovisionado[] {
  return resultado.usuarios.filter((u) => u.passwordGenerada);
}

/** Resumen del alta para el usuario: qué se creó y qué ya existía. */
export function resumirAlta(resultado: ResultadoAlta): string {
  const algoCreado =
    resultado.tenantCreado ||
    resultado.restauranteCreado ||
    resultado.usuarios.some((u) => u.creado);
  if (!algoCreado) {
    return "El establecimiento ya existía con estos datos: no se creó nada nuevo ni se cambiaron contraseñas.";
  }
  if (resultado.tenantCreado) {
    return "Establecimiento creado con su restaurante, mesa virtual y cuentas de Administrador, Cocina y comensal técnico.";
  }
  return "El establecimiento ya existía: se completaron los datos que faltaban.";
}

export const ETIQUETA_ROL: Record<UsuarioAprovisionado["rol"], string> = {
  ADMIN: "Administrador",
  COCINA: "Cocina",
  COMENSAL: "Comensal técnico",
};

/** "Creado por" para la tabla. */
export function describirCreadoPor(
  creadoPor: EstablecimientoListado["creadoPor"],
): string {
  if (!creadoPor) return "Sin registro";
  if (creadoPor.startsWith("script:")) {
    return `Script (${creadoPor.slice("script:".length)})`;
  }
  return creadoPor;
}

/** Fecha y hora del alta en Montevideo, p. ej. "09/10/2026 14:30". */
export function formatearFechaAlta(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .replace(",", "");
}

export function totalPaginas(total: number, tamanoPagina: number): number {
  return Math.max(1, Math.ceil(total / tamanoPagina));
}

/** Mensaje para un error de la API, con los casos que el usuario puede resolver. */
export function mensajeDeError(status: number, mensaje: string): string {
  if (status === 429) {
    return "Llegaste al límite de altas por hora. Probá de nuevo más tarde.";
  }
  if (status === 401) {
    return "Tu sesión venció. Volvé a ingresar.";
  }
  if (status === 403) {
    return "Tu usuario no tiene permiso para dar de alta establecimientos.";
  }
  return mensaje;
}
