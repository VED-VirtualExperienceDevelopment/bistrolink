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

/**
 * BL-409: RUT de Uruguay. Copia de apps/backend/src/plataforma/rut.ts (el
 * backend es quien decide; esto da el error antes y más claro). Si cambia
 * allá, cambia acá.
 *
 * 12 dígitos: registro 01–22, número de seis dígitos (no todos cero), «001»
 * y un dígito verificador: pesos 4,3,2,9,8,7,6,5,4,3,2 sobre los 11
 * primeros, (−suma) mod 11; si da 10, no hay verificador posible.
 */
const PESOS_RUT = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** BL-409: el RUT sin espacios, puntos ni guiones («21.999999-001-6» → «219999990016»). */
export function normalizarRut(rut: string): string {
  return rut.replaceAll(/[\s.-]/g, "");
}

/** BL-409: por qué el RUT no es válido, o undefined si lo es. */
export function errorDeRut(rut: string): string | undefined {
  const r = normalizarRut(rut);
  if (!/^\d{12}$/.test(r)) {
    return "Tienen que ser 12 dígitos (podés escribirlo con puntos o guiones)";
  }
  const registro = Number(r.slice(0, 2));
  if (registro < 1 || registro > 22 || r.slice(2, 8) === "000000") {
    return "No es un RUT válido: revisá los primeros 8 dígitos";
  }
  if (r.slice(8, 11) !== "001") {
    return "No es un RUT válido: los dígitos 9 a 11 son siempre 001";
  }
  let suma = 0;
  for (let i = 0; i < PESOS_RUT.length; i++) {
    suma += Number(r[i]) * PESOS_RUT[i];
  }
  const digito = (11 - (suma % 11)) % 11;
  if (digito === 10 || digito !== Number(r[11])) {
    return "No es un RUT válido: el último dígito (verificador) no corresponde";
  }
  return undefined;
}
const FORMATO_USERNAME = /^[a-z0-9][a-z0-9._-]{2,49}$/;

/**
 * Control básico de email (algo@dominio.tld), sin expresión regular: la
 * versión con regex (/^[^\s@]+@[^\s@]+\.[^\s@]+$/) tiene backtracking
 * superlineal (SonarCloud S5852). El backend vuelve a validar el email al
 * recibir el alta.
 */
export function esEmailValido(email: string): boolean {
  if (/\s/.test(email)) return false;
  const partes = email.split("@");
  if (partes.length !== 2) return false;
  const [local, dominio] = partes;
  const punto = dominio.lastIndexOf(".");
  return local.length > 0 && punto > 0 && punto < dominio.length - 1;
}

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
  const errorRut = errorDeRut(f.rut);
  if (errorRut) errores.rut = errorRut;
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

  if (!esEmailValido(f.adminEmail.trim())) {
    errores.adminEmail = "Email inválido";
  }
  requerido("adminNombre", 80);
  requerido("adminApellido", 80);
  if (f.cocinaEmail.trim() && !esEmailValido(f.cocinaEmail.trim())) {
    errores.cocinaEmail = "Email inválido";
  }

  return errores;
}

/**
 * Body de POST /plataforma/establecimientos. Sin tenantId, plan ni timezone:
 * (BL-409: el RUT va sin separadores.)
 * el backend usa los valores por defecto (BASICO, America/Montevideo) y busca
 * el tenant por RUT. Sin contraseñas: el backend las genera.
 */
export function construirPedidoAlta(f: FormularioAlta) {
  const cocinaEmail = f.cocinaEmail.trim();
  return {
    razonSocial: f.razonSocial.trim(),
    rut: normalizarRut(f.rut),
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

/**
 * BL-407: el alta de un establecimiento quedó incompleta si el tenant no
 * tiene restaurante.
 */
export function esAltaIncompleta(e: EstablecimientoListado): boolean {
  return e.restaurante === null;
}

/**
 * BL-407: formulario para completar un alta incompleta. La razón social y el
 * RUT son los del tenant que ya existe y no se cambian acá: el alta busca el
 * tenant por RUT, así que otro RUT daría de alta OTRO establecimiento. El
 * resto se completa a mano (el listado no trae datos del restaurante ni de
 * las cuentas).
 */
export function formularioParaCompletar(
  e: EstablecimientoListado,
): FormularioAlta {
  return { ...FORMULARIO_VACIO, razonSocial: e.razonSocial, rut: e.rut };
}

/** Usuarios con contraseña temporal para mostrar (una sola vez). */
export function credencialesAMostrar(
  resultado: ResultadoAlta,
): UsuarioAprovisionado[] {
  return resultado.usuarios.filter((u) => u.passwordGenerada);
}

/**
 * BL-408: usernames cuyas contraseñas temporales todavía no se copiaron. Si
 * queda alguno, cerrar el diálogo pide confirmación: esas contraseñas no se
 * pueden volver a ver.
 */
export function contrasenasSinCopiar(
  credenciales: UsuarioAprovisionado[],
  copiadas: ReadonlySet<string>,
): string[] {
  return credenciales
    .map((u) => u.username)
    .filter((username) => !copiadas.has(username));
}

/**
 * BL-408: aviso para el lector de pantalla después de intentar copiar una
 * contraseña («Contraseña de Cocina copiada»).
 */
export function avisoDeCopia(
  rol: UsuarioAprovisionado["rol"],
  copiada: boolean,
): string {
  const deQuien = `de ${ETIQUETA_ROL[rol]}`;
  return copiada
    ? `Contraseña ${deQuien} copiada`
    : `No se pudo copiar la contraseña ${deQuien}. Quedó seleccionada: copiala con Ctrl+C.`;
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

/**
 * BL-405: nombre del plan para mostrar. El backend guarda el valor interno
 * («BASICO»); a la persona se le muestra «Básico». Un plan que todavía no
 * está en la lista se muestra legible igual («PRO_ANUAL» → «Pro anual»).
 */
const NOMBRE_PLAN: Record<string, string> = {
  BASICO: "Básico",
};

export function etiquetaPlan(plan: string): string {
  const conocido = NOMBRE_PLAN[plan.toUpperCase()];
  if (conocido) return conocido;
  const texto = plan.replaceAll("_", " ").trim().toLowerCase();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : plan;
}

/**
 * BL-405: lo que se anuncia al lector de pantalla después de cada carga del
 * listado, p. ej. «Página 2 de 3. 45 establecimientos».
 *
 * BL-406: con una búsqueda, dice qué se buscó («3 establecimientos coinciden
 * con «uno»»).
 */
export function resumirPagina(
  datos: { total: number; tamanoPagina: number },
  pagina: number,
  busqueda = "",
): string {
  const texto = busqueda.trim();
  if (datos.total === 0) {
    return texto
      ? `Ningún establecimiento coincide con «${texto}»`
      : "Todavía no hay establecimientos";
  }
  const cantidad = `${datos.total} ${
    datos.total === 1 ? "establecimiento" : "establecimientos"
  }`;
  const resultado = texto
    ? `${cantidad} ${datos.total === 1 ? "coincide" : "coinciden"} con «${texto}»`
    : cantidad;
  return `Página ${pagina} de ${totalPaginas(datos.total, datos.tamanoPagina)}. ${resultado}`;
}

/** BL-406: largo máximo de la búsqueda (igual que MAX_LARGO_BUSQUEDA del backend). */
export const MAX_LARGO_BUSQUEDA = 100;

/**
 * BL-406: ruta del listado con la página y la búsqueda. El texto va
 * codificado (URLSearchParams) y sin espacios de más; si está vacío, no se
 * manda `q`.
 */
export function rutaListado(pagina: number, busqueda = ""): string {
  const params = new URLSearchParams({ pagina: String(pagina) });
  const texto = busqueda.trim();
  if (texto) params.set("q", texto);
  return `/plataforma/establecimientos?${params.toString()}`;
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
