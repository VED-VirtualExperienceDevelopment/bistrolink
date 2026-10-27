// BL-163 (HU-027): lógica pura de la pantalla /plataforma, separada de los
// componentes por el mismo motivo que landing.utils.ts y mapa-mesas.utils.ts:
// se testea con Jest sin DOM ni Keycloak (test/unitarios/plataforma.utils.spec.ts).
//
// Las validaciones calcan las del DTO del backend
// (AprovisionarEstablecimientoDto): el backend sigue siendo quien decide, esto
// solo evita un viaje de ida y vuelta para errores obvios.

import {
  errorNombrePersona,
  errorUsername,
  normalizarUsername,
} from "@/components/admin/usuarios/Usuarios.utils";
import type {
  CambiosEstablecimiento,
  CuentaFicha,
  EstablecimientoListado,
  EstadoEstablecimiento,
  FichaEstablecimiento,
  FiltroEstado,
  FormularioAdministrador,
  FormularioAlta,
  FormularioEdicion,
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
// BL-356 (H-02): empieza con una letra, igual que el backend
// (aprovisionar-establecimiento.dto.ts).
const FORMATO_USERNAME = /^[a-z][a-z0-9._-]{2,49}$/;
/** BL-356: mismo tope que el backend (RFC 5321). */
const LARGO_MAXIMO_EMAIL = 254;

/**
 * Control básico de email (algo@dominio.tld), sin expresión regular: la
 * versión con regex (/^[^\s@]+@[^\s@]+\.[^\s@]+$/) tiene backtracking
 * superlineal (SonarCloud S5852). El backend vuelve a validar el email al
 * recibir el alta.
 */
export function esEmailValido(email: string): boolean {
  if (email.length > LARGO_MAXIMO_EMAIL) return false;
  if (/\s/.test(email)) return false;
  const partes = email.split("@");
  if (partes.length !== 2) return false;
  const [local, dominio] = partes;
  const punto = dominio.lastIndexOf(".");
  return local.length > 0 && punto > 0 && punto < dominio.length - 1;
}

const MENSAJE_USERNAME =
  "De 3 a 50 caracteres, empezando con una letra; en minúsculas: letras, números, punto, guion o guion bajo";

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
 * BL-407: el alta de un establecimiento quedó incompleta.
 *
 * BL-410: lo decide el backend con `tenant.alta_completada_en` (se completa
 * al terminar el kit mínimo), no la falta de restaurante: un alta que se
 * cortó en Keycloak tiene restaurante y le faltan las cuentas. Así el
 * listado muestra lo mismo que devuelve el filtro «Alta incompleta».
 */
export function esAltaIncompleta(e: EstablecimientoListado): boolean {
  return e.estado === "ALTA_INCOMPLETA";
}

/** BL-410: opciones del filtro por estado, en el orden en que se muestran. */
export const OPCIONES_FILTRO_ESTADO: {
  valor: FiltroEstado;
  etiqueta: string;
}[] = [
  { valor: "ACTIVOS", etiqueta: "Activos" },
  { valor: "SUSPENDIDOS", etiqueta: "Suspendidos" },
  { valor: "ALTA_INCOMPLETA", etiqueta: "Alta incompleta" },
];

/** BL-410: el valor del `select` como filtro («» = todos). */
export function filtroEstadoDesde(valor: string): FiltroEstado | undefined {
  return OPCIONES_FILTRO_ESTADO.find((o) => o.valor === valor)?.valor;
}

function etiquetaFiltroEstado(estado: FiltroEstado): string {
  return (
    OPCIONES_FILTRO_ESTADO.find((o) => o.valor === estado)?.etiqueta ?? estado
  );
}

/**
 * BL-410: qué se pidió, para los avisos («con «uno» y el filtro
 * «Suspendidos»»). Vacío si no hay búsqueda ni filtro.
 */
export function describirCriterio(
  busqueda = "",
  estado?: FiltroEstado,
): string {
  const texto = busqueda.trim();
  const partes: string[] = [];
  if (texto) partes.push(`«${texto}»`);
  if (estado) partes.push(`el filtro «${etiquetaFiltroEstado(estado)}»`);
  return partes.join(" y ");
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
 *
 * BL-410: también con el filtro por estado («2 establecimientos coinciden con
 * el filtro «Suspendidos»»).
 */
export function resumirPagina(
  datos: { total: number; tamanoPagina: number },
  pagina: number,
  busqueda = "",
  estado?: FiltroEstado,
): string {
  const criterio = describirCriterio(busqueda, estado);
  if (datos.total === 0) {
    return criterio
      ? `Ningún establecimiento coincide con ${criterio}`
      : "Todavía no hay establecimientos";
  }
  const cantidad = `${datos.total} ${
    datos.total === 1 ? "establecimiento" : "establecimientos"
  }`;
  const verbo = datos.total === 1 ? "coincide" : "coinciden";
  const resultado = criterio
    ? `${cantidad} ${verbo} con ${criterio}`
    : cantidad;
  return `Página ${pagina} de ${totalPaginas(datos.total, datos.tamanoPagina)}. ${resultado}`;
}

/** BL-406: largo máximo de la búsqueda (igual que MAX_LARGO_BUSQUEDA del backend). */
export const MAX_LARGO_BUSQUEDA = 100;

/**
 * BL-406: ruta del listado con la página y la búsqueda. El texto va
 * codificado (URLSearchParams) y sin espacios de más; si está vacío, no se
 * manda `q`.
 *
 * BL-410: con el filtro por estado, se manda `estado`.
 */
export function rutaListado(
  pagina: number,
  busqueda = "",
  estado?: FiltroEstado,
): string {
  const params = new URLSearchParams({ pagina: String(pagina) });
  const texto = busqueda.trim();
  if (texto) params.set("q", texto);
  if (estado) params.set("estado", estado);
  return `/plataforma/establecimientos?${params.toString()}`;
}

// ── BL-411: ficha del establecimiento ───────────────────────────────────────

/**
 * BL-411: ruta de la ficha. Es la misma en la pantalla y en la API
 * (GET /plataforma/establecimientos/:tenantId). El id va codificado por si
 * llega algo raro desde la URL; la API igual lo valida.
 */
export function rutaFicha(tenantId: string): string {
  return `/plataforma/establecimientos/${encodeURIComponent(tenantId)}`;
}

/** BL-411: nombre del estado para personas. */
export const ETIQUETA_ESTADO: Record<EstadoEstablecimiento, string> = {
  ACTIVO: "Activo",
  SUSPENDIDO: "Suspendido",
  ALTA_INCOMPLETA: "Alta incompleta",
};

/**
 * BL-411: «Ana Gómez»; si no tiene nombre cargado, el usuario. BL-414: sirve
 * también para el Administrador recién creado (solo usa estos tres datos).
 */
export function nombreDeCuenta(
  cuenta: Pick<CuentaFicha, "nombre" | "apellido" | "username">,
): string {
  const nombre = [cuenta.nombre, cuenta.apellido]
    .filter((parte) => parte?.trim())
    .join(" ")
    .trim();
  return nombre || cuenta.username || "Sin nombre";
}

/** BL-411: mensaje si la ficha no se pudo cargar. */
export function mensajeErrorFicha(status: number, mensaje: string): string {
  if (status === 404) {
    return "No existe un establecimiento con ese id. Puede que se haya eliminado o que el enlace esté mal copiado.";
  }
  if (status === 400) {
    return "El enlace de la ficha no es válido.";
  }
  if (status === 429) {
    return "Hiciste muchas consultas seguidas. Esperá un minuto y volvé a intentar.";
  }
  if (status === 401) {
    return "Tu sesión venció. Volvé a ingresar.";
  }
  if (status === 403) {
    return "Tu usuario no tiene permiso para ver establecimientos.";
  }
  return mensaje;
}

// ── BL-412: corregir los datos del establecimiento ──────────────────────────

/** BL-412: espacios de más afuera (como limpiarEspacios del backend). */
function limpiar(texto: string): string {
  return texto.trim().replaceAll(/\s+/g, " ");
}

/** BL-412: el formulario «Editar» con los datos actuales de la ficha. */
export function formularioEdicionDesde(
  ficha: FichaEstablecimiento,
): FormularioEdicion {
  return {
    razonSocial: ficha.razonSocial,
    rut: ficha.rut,
    plan: ficha.plan,
    restauranteNombre: ficha.restaurante?.nombre ?? "",
    restauranteDireccion: ficha.restaurante?.direccion ?? "",
  };
}

/**
 * BL-412: planes que se ofrecen en el formulario. Si el establecimiento
 * tiene un plan que no está en la lista, se agrega para no perderlo.
 */
export function opcionesPlan(
  planActual: string,
): { valor: string; etiqueta: string }[] {
  const opciones = Object.keys(NOMBRE_PLAN).map((valor) => ({
    valor,
    etiqueta: etiquetaPlan(valor),
  }));
  if (planActual && !opciones.some((o) => o.valor === planActual)) {
    opciones.push({ valor: planActual, etiqueta: etiquetaPlan(planActual) });
  }
  return opciones;
}

export type ErroresEdicion = Partial<Record<keyof FormularioEdicion, string>>;

/**
 * BL-412: errores por campo (vacío = válido). Mismas reglas que
 * EditarEstablecimientoDto. Los datos del restaurante se validan solo si
 * tiene restaurante (si no, el formulario no los muestra).
 */
export function validarEdicion(
  f: FormularioEdicion,
  tieneRestaurante: boolean,
): ErroresEdicion {
  const errores: ErroresEdicion = {};
  const requerido = (campo: keyof FormularioEdicion, max: number) => {
    const valor = limpiar(f[campo]);
    if (!valor) errores[campo] = "Obligatorio";
    else if (valor.length > max) errores[campo] = `Máximo ${max} caracteres`;
  };
  requerido("razonSocial", 200);
  const errorRut = errorDeRut(f.rut);
  if (errorRut) errores.rut = errorRut;
  if (tieneRestaurante) {
    requerido("restauranteNombre", 120);
    requerido("restauranteDireccion", 200);
  }
  return errores;
}

/**
 * BL-412: body del PATCH, solo con lo que cambió (mismo criterio que
 * Usuarios, BL-366). El RUT se compara y se manda sin separadores.
 */
export function cambiosDeEdicion(
  ficha: FichaEstablecimiento,
  f: FormularioEdicion,
): CambiosEstablecimiento {
  const cambios: CambiosEstablecimiento = {};
  const razonSocial = limpiar(f.razonSocial);
  if (razonSocial !== ficha.razonSocial) cambios.razonSocial = razonSocial;
  const rut = normalizarRut(f.rut);
  if (rut !== ficha.rut) cambios.rut = rut;
  if (f.plan !== ficha.plan) cambios.plan = f.plan;
  if (ficha.restaurante) {
    const nombre = limpiar(f.restauranteNombre);
    if (nombre !== ficha.restaurante.nombre) cambios.restauranteNombre = nombre;
    const direccion = limpiar(f.restauranteDireccion);
    if (direccion !== ficha.restaurante.direccion) {
      cambios.restauranteDireccion = direccion;
    }
  }
  return cambios;
}

/** BL-412: mensaje si no se pudieron guardar los datos. */
export function mensajeErrorEdicion(status: number, mensaje: string): string {
  if (status === 429) {
    return "Llegaste al límite de ediciones por hora. Probá de nuevo más tarde.";
  }
  if (status === 401) {
    return "Tu sesión venció. Volvé a ingresar.";
  }
  if (status === 403) {
    return "Tu usuario no tiene permiso para editar establecimientos.";
  }
  // 409 (RUT de otro establecimiento, alta sin restaurante) y 400 llegan
  // con el mensaje del backend.
  return mensaje;
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

// ── BL-413: suspender y reactivar ───────────────────────────────────────────

/** BL-413: rutas de la API para cambiar el estado. */
export function rutaSuspender(tenantId: string): string {
  return `${rutaFicha(tenantId)}/suspender`;
}

export function rutaReactivar(tenantId: string): string {
  return `${rutaFicha(tenantId)}/reactivar`;
}

/**
 * BL-413: ruta y opciones del POST para suspender (con el motivo limpio) o
 * reactivar (sin body).
 */
export function solicitudCambioEstado(
  accion: "suspender" | "reactivar",
  tenantId: string,
  motivo: string,
): { ruta: string; init: RequestInit } {
  if (accion === "reactivar") {
    return { ruta: rutaReactivar(tenantId), init: { method: "POST" } };
  }
  return {
    ruta: rutaSuspender(tenantId),
    init: {
      method: "POST",
      body: JSON.stringify({ motivo: motivoLimpio(motivo) }),
    },
  };
}

/** BL-413: largo del motivo, el mismo que SuspenderEstablecimientoDto. */
export const LARGO_MINIMO_MOTIVO = 3;
export const LARGO_MAXIMO_MOTIVO = 200;

/** BL-413: el motivo tal como se manda (espacios de más afuera). */
export function motivoLimpio(motivo: string): string {
  return limpiar(motivo);
}

/** BL-413: error del motivo, o undefined si es válido. */
export function errorDeMotivo(motivo: string): string | undefined {
  const largo = motivoLimpio(motivo).length;
  if (largo === 0) return "Escribí el motivo de la suspensión";
  if (largo < LARGO_MINIMO_MOTIVO) {
    return `Al menos ${LARGO_MINIMO_MOTIVO} caracteres`;
  }
  if (largo > LARGO_MAXIMO_MOTIVO) {
    return `Máximo ${LARGO_MAXIMO_MOTIVO} caracteres`;
  }
  return undefined;
}

/**
 * BL-413: aviso de pedidos abiertos antes de suspender. null si no hay (o si
 * el establecimiento no tiene restaurante todavía).
 */
export function avisoPedidosAbiertos(
  pedidosAbiertos: number | undefined,
): string | null {
  if (!pedidosAbiertos) return null;
  if (pedidosAbiertos === 1) {
    return "Hay 1 pedido abierto. No se cancela, pero el restaurante no lo va a poder mover hasta que se reactive.";
  }
  return `Hay ${pedidosAbiertos} pedidos abiertos. No se cancelan, pero el restaurante no los va a poder mover hasta que se reactive.`;
}

/** BL-413: mensaje si no se pudo suspender o reactivar. */
export function mensajeErrorCambioEstado(
  status: number,
  mensaje: string,
): string {
  if (status === 429) {
    return "Llegaste al límite de cambios de estado por hora. Probá de nuevo más tarde.";
  }
  if (status === 401) {
    return "Tu sesión venció. Volvé a ingresar.";
  }
  if (status === 403) {
    return "Tu usuario no tiene permiso para suspender ni reactivar establecimientos.";
  }
  // 409 (ya estaba suspendido o activo), 404 y 400 llegan con el mensaje del
  // backend.
  return mensaje;
}

// ── BL-414: recuperar el acceso del Administrador ───────────────────────────

/** BL-414: rutas de la API (POST). */
export function rutaAdministradores(tenantId: string): string {
  return `${rutaFicha(tenantId)}/administradores`;
}

export function rutaRestablecerAdministrador(
  tenantId: string,
  usuarioId: string,
): string {
  return `${rutaAdministradores(tenantId)}/${encodeURIComponent(usuarioId)}/restablecer-contrasena`;
}

export const FORMULARIO_ADMIN_VACIO: FormularioAdministrador = {
  nombre: "",
  apellido: "",
  username: "",
  email: "",
};

/** BL-414: errores por campo; un objeto vacío quiere decir que es válido. */
export type ErroresAdministrador = Partial<
  Record<keyof FormularioAdministrador, string>
>;

/**
 * BL-414: mismas reglas que «Nuevo usuario» (nombre, apellido y usuario de 3
 * a 30 caracteres), con el correo obligatorio como en el alta del
 * establecimiento: el perfil del realm lo exige.
 */
export function validarFormularioAdministrador(
  f: FormularioAdministrador,
): ErroresAdministrador {
  const errores: ErroresAdministrador = {};
  const nombre = errorNombrePersona(f.nombre, "nombre");
  if (nombre) errores.nombre = nombre;
  const apellido = errorNombrePersona(f.apellido, "apellido");
  if (apellido) errores.apellido = apellido;
  const username = errorUsername(f.username);
  if (username) errores.username = username;
  const email = f.email.trim();
  if (!email) {
    errores.email = "Ingresá el correo.";
  } else if (!esEmailValido(email)) {
    errores.email = "Ingresá un correo válido, por ejemplo ana@restaurante.uy.";
  }
  return errores;
}

/** BL-414: body de POST /administradores, con los textos limpios. */
export function construirPedidoAdministrador(f: FormularioAdministrador) {
  return {
    nombre: limpiar(f.nombre),
    apellido: limpiar(f.apellido),
    username: normalizarUsername(f.username),
    email: f.email.trim(),
  };
}

/** BL-414: aviso para el lector de pantalla después de intentar copiar. */
export function avisoCopiaContrasena(
  deQuien: string,
  copiada: boolean,
): string {
  return copiada
    ? `Contraseña de ${deQuien} copiada`
    : `No se pudo copiar la contraseña de ${deQuien}. Quedó seleccionada: copiala con Ctrl+C.`;
}

/** BL-414: mensaje si no se pudo restablecer ni crear. */
export function mensajeErrorAccesoAdmin(
  status: number,
  mensaje: string,
): string {
  if (status === 429) {
    return "Llegaste al límite de accesos por hora. Probá de nuevo más tarde.";
  }
  if (status === 401) {
    return "Tu sesión venció. Volvé a ingresar.";
  }
  if (status === 403) {
    return "Tu usuario no tiene permiso para gestionar el acceso de los establecimientos.";
  }
  // 404 (no es un Administrador de este establecimiento), 409 (desactivado,
  // sin restaurante, usuario o correo ya usados) y 400 llegan con el mensaje
  // del backend.
  return mensaje;
}
