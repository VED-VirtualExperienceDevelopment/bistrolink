/**
 * HU-035 (BL-205): registro de auditoría para el administrador.
 * Lógica pura de la pantalla /admin/auditoria (probada en
 * test/unitarios/auditoria.utils.spec.ts).
 */

/** Respuesta de GET /auditoria (backend: PaginaAuditoria). */
export interface RegistroAuditoria {
  id: string;
  fecha: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  usuario: { id: string; nombre: string } | null;
  actorKeycloakId: string;
  valoresAntes: Record<string, unknown> | null;
  valoresDespues: Record<string, unknown> | null;
  detalle: Record<string, unknown> | null;
  ip: string | null;
}

export interface PaginaAuditoria {
  registros: RegistroAuditoria[];
  pagina: number;
  hayMas: boolean;
}

export interface FiltrosAuditoria {
  /** yyyy-mm-dd (input type="date"), o vacío. */
  desde: string;
  hasta: string;
  usuarioId: string;
  accion: string;
}

export const FILTROS_AUDITORIA_INICIALES: FiltrosAuditoria = {
  desde: "",
  hasta: "",
  usuarioId: "",
  accion: "",
};

/** Texto de cada acción (las del enum AuditAction del backend). */
export const ETIQUETAS_ACCION: Record<string, string> = {
  USUARIO_CREADO: "Alta de usuario",
  USUARIO_ROL_MODIFICADO: "Cambio de rol",
  USUARIO_DESACTIVADO: "Usuario desactivado",
  USUARIO_DESACTIVACION_RECHAZADA: "Desactivación rechazada",
  USUARIO_REACTIVADO: "Usuario reactivado",
  USUARIO_CONTRASENA_RESTABLECIDA: "Contraseña restablecida",
  USUARIO_DATOS_MODIFICADOS: "Datos de usuario modificados",
  USUARIO_SESIONES_CERRADAS: "Sesiones cerradas",
  USUARIO_ELIMINADO: "Usuario eliminado",
  ESTABLECIMIENTO_APROVISIONADO: "Alta del establecimiento",
  ESTABLECIMIENTO_DATOS_MODIFICADOS: "Datos del establecimiento modificados",
  ESTABLECIMIENTO_SUSPENDIDO: "Establecimiento suspendido",
  ESTABLECIMIENTO_REACTIVADO: "Establecimiento reactivado",
  ESTABLECIMIENTO_ADMIN_CONTRASENA_RESTABLECIDA:
    "Contraseña de administrador restablecida",
  ESTABLECIMIENTO_ADMIN_CREADO: "Administrador agregado",
  ESTABLECIMIENTO_ELIMINADO: "Establecimiento eliminado",
  CARTA_ITEM_IMAGEN_CAMBIADA: "Imagen de un ítem",
  CARTA_ITEM_MODIFICADO: "Precio o disponibilidad de un ítem",
  CARTA_ITEM_DADO_DE_BAJA: "Ítem dado de baja",
  // BL-396: Gestión de Carta (BL-392).
  CARTA_ITEM_CREADO: "Alta de un ítem de la carta",
  CARTA_ITEM_ARCHIVADO: "Ítem archivado",
  CARTA_ITEM_RESTAURADO: "Ítem restaurado",
  CARTA_ITEM_ELIMINADO: "Ítem eliminado",
  CARTA_CATEGORIA_CREADA: "Alta de una categoría de la carta",
  CARTA_CATEGORIA_MODIFICADA: "Categoría modificada",
  CARTA_CATEGORIA_ARCHIVADA: "Categoría archivada",
  CARTA_CATEGORIA_RESTAURADA: "Categoría restaurada",
  CARTA_CATEGORIA_ELIMINADA: "Categoría eliminada",
  MESA_PEDIDOS_CANCELADOS: "Pedidos cancelados al cerrar la mesa",
  PAGO_EFECTIVO_REGISTRADO: "Cobro en efectivo",
};

export function etiquetaAccion(accion: string): string {
  return ETIQUETAS_ACCION[accion] ?? accion;
}

/**
 * Uruguay no tiene horario de verano: UTC-3 todo el año. Un día del filtro
 * va de las 00:00 a las 23:59:59.999 de Uruguay.
 */
const ZONA_URUGUAY = "-03:00";

export function rutaAuditoria(filtros: FiltrosAuditoria, pagina = 1): string {
  const parametros = new URLSearchParams();
  if (filtros.desde)
    parametros.set("desde", `${filtros.desde}T00:00:00.000${ZONA_URUGUAY}`);
  if (filtros.hasta)
    parametros.set("hasta", `${filtros.hasta}T23:59:59.999${ZONA_URUGUAY}`);
  if (filtros.usuarioId) parametros.set("usuarioId", filtros.usuarioId);
  if (filtros.accion) parametros.set("accion", filtros.accion);
  if (pagina > 1) parametros.set("pagina", String(pagina));
  const query = parametros.toString();
  return query ? `/auditoria?${query}` : "/auditoria";
}

/** «desde» posterior a «hasta»: el backend respondería 400. */
export function rangoInvalido(filtros: FiltrosAuditoria): boolean {
  return Boolean(
    filtros.desde && filtros.hasta && filtros.desde > filtros.hasta,
  );
}

const FORMATO_FECHA = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** «27/10/2026, 21:05» en hora de Uruguay. */
export function fechaParaMostrar(iso: string): string {
  return FORMATO_FECHA.format(new Date(iso));
}

const NOMBRE_CAMPO: Record<string, string> = {
  precio: "Precio",
  disponible: "Disponible",
  rol: "Rol",
  imagenKey: "Imagen",
  // HU-031 (BL-201): cobro en efectivo.
  monto: "Total",
  montoRecibido: "Recibido",
  vuelto: "Vuelto",
  // BL-396: categorías de la carta.
  nombre: "Nombre",
  descripcion: "Descripción",
  visible: "Visible",
};

function valorParaMostrar(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (valor === true) return "sí";
  if (valor === false) return "no";
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "bigint")
    return valor.toString();
  return JSON.stringify(valor);
}

/**
 * Cambios de un registro como «Precio: 12.50 → 14.00». Toma los campos que
 * aparecen antes o después (uno de los dos puede faltar: un alta no tiene
 * valor anterior).
 */
export function cambiosDelRegistro(
  registro: Pick<RegistroAuditoria, "valoresAntes" | "valoresDespues">,
): string[] {
  const antes = registro.valoresAntes ?? {};
  const despues = registro.valoresDespues ?? {};
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])];
  return campos.map(
    (campo) =>
      `${NOMBRE_CAMPO[campo] ?? campo}: ${valorParaMostrar(antes[campo])} → ${valorParaMostrar(despues[campo])}`,
  );
}

/**
 * BL-396: sobre qué se hizo la acción, cuando el registro lo dice (por
 * ejemplo, el nombre del ítem o la categoría de la carta). Va entre comillas
 * angulares, como en el resto de los textos.
 */
export function objetoDelRegistro(
  registro: Pick<RegistroAuditoria, "detalle">,
): string | null {
  const nombre = registro.detalle?.nombre;
  return typeof nombre === "string" && nombre.trim() !== ""
    ? `«${nombre}»`
    : null;
}

/** Quién hizo la acción, para mostrar. */
export function autorDelRegistro(
  registro: Pick<RegistroAuditoria, "usuario" | "actorKeycloakId">,
): string {
  if (registro.usuario) return registro.usuario.nombre;
  if (registro.actorKeycloakId.startsWith("script:"))
    return "Proceso automático";
  return "Plataforma o usuario eliminado";
}

export function hayFiltrosAuditoria(filtros: FiltrosAuditoria): boolean {
  return Object.values(filtros).some(Boolean);
}
