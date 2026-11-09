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
  // HU-020 (BL-72): medios de pago, propinas, proveedor de CFE y razón social.
  ESTABLECIMIENTO_CONFIGURACION_MODIFICADA:
    "Configuración del establecimiento modificada",
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
  // HU-007b (BL-80): cobro con el POS del local.
  PAGO_POS_REGISTRADO: "Cobro con el POS del local",
  // HU-015 (BL-120): stock de la jornada.
  CARTA_ITEM_STOCK_AJUSTADO: "Stock de un ítem ajustado",
  CARTA_ITEM_VENDIDO_SIN_STOCK: "Venta sin stock",
  // HU-009 (BL-453): supresión de los datos de la e-Factura de un comensal.
  PEDIDO_RECEPTOR_ANONIMIZADO: "Datos de facturación anonimizados",
  // HU-024 (BL-104): cancelación de un pedido pagado, con la devolución.
  PEDIDO_CANCELADO: "Pedido cancelado y pago devuelto",
  // BL-501: pedido cancelado antes de cobrarlo (no hubo devolución).
  PEDIDO_PENDIENTE_CANCELADO: "Pedido sin cobrar cancelado",
  // HU-023 (BL-96): reintento manual de la emisión de un CFE.
  PAGO_CFE_REINTENTADO: "Reintento de emisión de comprobante",
  // BL-475 (BL-285): solo en staging y local (E2E_CLEANUP_ENABLED).
  PEDIDO_LIMPIEZA_PRUEBAS: "Pedidos de prueba cerrados (limpieza)",
  MESA_LIMPIEZA_PRUEBAS: "Mesas y plano de prueba restablecidos (limpieza)",
  CARTA_ITEM_LIMPIEZA_PRUEBAS:
    "Carta y stock de prueba restablecidos (limpieza)",
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
  // HU-007b (BL-80): cobro con el POS del local.
  medio: "Tarjeta",
  autorizacion: "N.° de autorización",
  // HU-024 (BL-104): cancelación de un pedido pagado.
  motivo: "Motivo",
  devolucion: "Devolución",
  stockRepuesto: "Stock repuesto",
  // BL-396: categorías de la carta.
  nombre: "Nombre",
  descripcion: "Descripción",
  visible: "Visible",
  // HU-020 (BL-72): configuración del establecimiento.
  razonSocial: "Razón social",
  efectivoHabilitado: "Efectivo",
  mercadoPagoHabilitado: "Mercado Pago",
  posHabilitado: "POS del local",
  // HU-011 (BL-488): envío de las ventas al POS del local.
  posSincronizacionHabilitada: "Envío de ventas al POS",
  plexoHabilitado: "Plexo",
  handyHabilitado: "Handy",
  propinasSugeridas: "Propinas sugeridas (%)",
  cfeProveedor: "Proveedor de CFE",
  // HU-042 (BL-465): cola del KDS. Sin límite (—) = cola desactivada.
  limitePedidosEnPreparacion: "Límite de pedidos en preparación",
  umbralAlertaCola: "Alerta de alta demanda con",
  minutosPreparacionEstimados: "Minutos de preparación estimados",
  // BL-412: datos del establecimiento que cambia la plataforma.
  rut: "RUT",
  plan: "Plan",
  restauranteNombre: "Nombre del restaurante",
  restauranteDireccion: "Dirección del restaurante",
  // HU-015 (BL-120): stock de la jornada.
  controlaStock: "Controla stock",
  stockActual: "Unidades",
  umbralAlerta: "Aviso con",
};

/** HU-020 (BL-72): valores de un campo que se muestran con otro texto. */
const VALOR_POR_CAMPO: Record<string, Record<string, string>> = {
  cfeProveedor: { SURTEC: "Surtec", BILLER: "Biller" },
};

function valorParaMostrar(valor: unknown, campo = ""): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (valor === true) return "sí";
  if (valor === false) return "no";
  if (typeof valor === "string")
    return VALOR_POR_CAMPO[campo]?.[valor] ?? valor;
  if (typeof valor === "number" || typeof valor === "bigint")
    return valor.toString();
  // HU-020 (BL-72): una lista simple (las propinas) como «10, 15, 20».
  if (
    Array.isArray(valor) &&
    valor.every((v) => typeof v === "number" || typeof v === "string")
  )
    return valor.length === 0 ? "—" : valor.join(", ");
  return JSON.stringify(valor);
}

/**
 * HU-020 (BL-72): campos que cambiaron pero se auditan sin el valor (por
 * ejemplo, la razón social), listados en `detalle.campos`.
 */
function camposSinValor(
  detalle: RegistroAuditoria["detalle"] | undefined,
  conValor: Set<string>,
): string[] {
  const campos = detalle?.campos;
  if (!Array.isArray(campos)) return [];
  return campos.filter(
    (campo): campo is string =>
      typeof campo === "string" && !conValor.has(campo),
  );
}

/**
 * Cambios de un registro como «Precio: 12.50 → 14.00». Toma los campos que
 * aparecen antes o después (uno de los dos puede faltar: un alta no tiene
 * valor anterior). Los que cambiaron sin guardar el valor (HU-020, BL-72)
 * van al final como «Razón social: modificado».
 */
export function cambiosDelRegistro(
  registro: Pick<RegistroAuditoria, "valoresAntes" | "valoresDespues"> &
    Partial<Pick<RegistroAuditoria, "detalle">>,
): string[] {
  const antes = registro.valoresAntes ?? {};
  const despues = registro.valoresDespues ?? {};
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(despues)])];
  const conValor = campos.map(
    (campo) =>
      `${NOMBRE_CAMPO[campo] ?? campo}: ${valorParaMostrar(antes[campo], campo)} → ${valorParaMostrar(despues[campo], campo)}`,
  );
  const sinValor = camposSinValor(registro.detalle, new Set(campos)).map(
    (campo) => `${NOMBRE_CAMPO[campo] ?? campo}: modificado`,
  );
  // HU-015 (BL-120): unidades que se vendieron sin stock (ADR 0009).
  const unidadesDeMas = registro.detalle?.unidadesDeMas;
  const sinStock =
    typeof unidadesDeMas === "number"
      ? [`Unidades vendidas sin stock: ${unidadesDeMas}`]
      : [];
  return [...conValor, ...sinValor, ...sinStock];
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
  // HU-015 (BL-120): «sistema:» es el descuento de stock al confirmar un pago.
  if (
    registro.actorKeycloakId.startsWith("script:") ||
    registro.actorKeycloakId.startsWith("sistema:")
  )
    return "Proceso automático";
  return "Plataforma o usuario eliminado";
}

export function hayFiltrosAuditoria(filtros: FiltrosAuditoria): boolean {
  return Object.values(filtros).some(Boolean);
}
