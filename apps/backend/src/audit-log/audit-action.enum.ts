/**
 * Acciones auditables del DoD de HU-013:
 * "Logs de auditoría de cambios de roles y de altas/bajas de cuentas
 * Administrador registrados en Pino con nivel INFO."
 *
 * Se registra toda alta/cambio de rol/baja de usuario (no solo Admin) con
 * el campo `rol` en el detalle — así una query en Grafana Loki puede
 * filtrar específicamente los eventos de cuentas Administrador
 * (detalle.rol = "ADMIN" o detalle.rolNuevo/rolAnterior = "ADMIN") sin
 * necesitar un enum separado por rol.
 */
export enum AuditAction {
  USUARIO_CREADO = 'USUARIO_CREADO',
  USUARIO_ROL_MODIFICADO = 'USUARIO_ROL_MODIFICADO',
  USUARIO_DESACTIVADO = 'USUARIO_DESACTIVADO',
  USUARIO_DESACTIVACION_RECHAZADA = 'USUARIO_DESACTIVACION_RECHAZADA', // RF.19: último Admin
  USUARIO_REACTIVADO = 'USUARIO_REACTIVADO', // BL-358
  USUARIO_CONTRASENA_RESTABLECIDA = 'USUARIO_CONTRASENA_RESTABLECIDA', // BL-359 (nunca con la contraseña)
  USUARIO_DATOS_MODIFICADOS = 'USUARIO_DATOS_MODIFICADOS', // BL-366 (qué campos, sin los valores)
  USUARIO_SESIONES_CERRADAS = 'USUARIO_SESIONES_CERRADAS', // BL-367
  USUARIO_ELIMINADO = 'USUARIO_ELIMINADO', // BL-382 (solo usuarios sin historial)
  ESTABLECIMIENTO_APROVISIONADO = 'ESTABLECIMIENTO_APROVISIONADO', // BL-163 (HU-027)
  ESTABLECIMIENTO_DATOS_MODIFICADOS = 'ESTABLECIMIENTO_DATOS_MODIFICADOS', // BL-412 (qué campos, sin los valores)
  ESTABLECIMIENTO_SUSPENDIDO = 'ESTABLECIMIENTO_SUSPENDIDO', // BL-413 (con motivo, pedidos abiertos y sesiones cerradas)
  ESTABLECIMIENTO_REACTIVADO = 'ESTABLECIMIENTO_REACTIVADO', // BL-413
  ESTABLECIMIENTO_ADMIN_CONTRASENA_RESTABLECIDA = 'ESTABLECIMIENTO_ADMIN_CONTRASENA_RESTABLECIDA', // BL-414 (la plataforma, nunca con la contraseña)
  ESTABLECIMIENTO_ADMIN_CREADO = 'ESTABLECIMIENTO_ADMIN_CREADO', // BL-414 (Administrador nuevo creado por la plataforma)
  ESTABLECIMIENTO_ELIMINADO = 'ESTABLECIMIENTO_ELIMINADO', // BL-418 (solo sin actividad; con el RUT y las cuentas de Keycloak que quedaron)
  ESTABLECIMIENTO_CONFIGURACION_MODIFICADA = 'ESTABLECIMIENTO_CONFIGURACION_MODIFICADA', // BL-72 (HU-020: medios de pago, propinas y proveedor de CFE con antes y después; la razón social, sin el valor)
  CARTA_ITEM_IMAGEN_CAMBIADA = 'CARTA_ITEM_IMAGEN_CAMBIADA', // BL-387 (alta, cambio o quita de la imagen de un ítem)
  CARTA_ITEM_MODIFICADO = 'CARTA_ITEM_MODIFICADO', // BL-205 (HU-005: precio o disponibilidad, con antes y después)
  CARTA_ITEM_DADO_DE_BAJA = 'CARTA_ITEM_DADO_DE_BAJA', // BL-205 (baja de un ítem: pasa a no disponible). Ya no se genera desde BL-394; queda para los registros anteriores
  // BL-396 (Gestión de Carta, BL-392): con el nombre en el detalle, sin datos personales.
  CARTA_ITEM_CREADO = 'CARTA_ITEM_CREADO', // con precio y disponibilidad iniciales
  CARTA_ITEM_ARCHIVADO = 'CARTA_ITEM_ARCHIVADO',
  CARTA_ITEM_RESTAURADO = 'CARTA_ITEM_RESTAURADO',
  CARTA_ITEM_ELIMINADO = 'CARTA_ITEM_ELIMINADO', // solo ítems sin pedidos
  CARTA_ITEM_STOCK_AJUSTADO = 'CARTA_ITEM_STOCK_AJUSTADO', // BL-120 (HU-015: control de stock, unidades, umbral y disponibilidad, con antes y después)
  CARTA_ITEM_VENDIDO_SIN_STOCK = 'CARTA_ITEM_VENDIDO_SIN_STOCK', // BL-120 (ADR 0009: dos pagos casi simultáneos se llevaron las últimas unidades; con el pedido y cuántas de más)
  CARTA_ITEM_LIMPIEZA_PRUEBAS = 'CARTA_ITEM_LIMPIEZA_PRUEBAS', // BL-480 (BL-285: limpieza de datos de prueba; ítems y categorías «E2E» borrados o archivados y carta del seed restablecida)
  CARTA_CATEGORIA_CREADA = 'CARTA_CATEGORIA_CREADA',
  CARTA_CATEGORIA_MODIFICADA = 'CARTA_CATEGORIA_MODIFICADA', // nombre, descripción o visibilidad, con antes y después
  CARTA_CATEGORIA_ARCHIVADA = 'CARTA_CATEGORIA_ARCHIVADA',
  CARTA_CATEGORIA_RESTAURADA = 'CARTA_CATEGORIA_RESTAURADA',
  CARTA_CATEGORIA_ELIMINADA = 'CARTA_CATEGORIA_ELIMINADA', // solo categorías sin ítems
  MESA_PEDIDOS_CANCELADOS = 'MESA_PEDIDOS_CANCELADOS', // BL-205 (al cerrar la mesa se cancelan los pedidos sin pagar, HU-017)
  MESA_LIMPIEZA_PRUEBAS = 'MESA_LIMPIEZA_PRUEBAS', // BL-479 (BL-285: limpieza de datos de prueba; mesas reabiertas, liberadas y eliminadas y zonas «Zona E2E» quitadas)
  PAGO_EFECTIVO_REGISTRADO = 'PAGO_EFECTIVO_REGISTRADO', // BL-201 (HU-031: cobro en efectivo, con monto recibido y vuelto)
  PAGO_POS_REGISTRADO = 'PAGO_POS_REGISTRADO', // BL-80 (HU-007b: cobro con el POS del local, con total, tipo de tarjeta y n.° de autorización; nunca datos de la tarjeta)
  PEDIDO_CANCELADO = 'PEDIDO_CANCELADO', // BL-104 (HU-024: pedido pagado cancelado por el personal, con motivo, monto devuelto y medio; reembolso automático o devolución manual)
  PEDIDO_RECEPTOR_ANONIMIZADO = 'PEDIDO_RECEPTOR_ANONIMIZADO', // BL-453 (HU-009: RUT y razón social de la e-Factura anonimizados; con la cantidad de pedidos, nunca el RUT)
  PAGO_CFE_REINTENTADO = 'PAGO_CFE_REINTENTADO', // BL-96 (HU-023: el administrador reintentó la emisión del CFE de un pago, con el resultado)
  PEDIDO_LIMPIEZA_PRUEBAS = 'PEDIDO_LIMPIEZA_PRUEBAS', // BL-475 (BL-285: limpieza de datos de prueba, solo con E2E_CLEANUP_ENABLED; con cuántos pedidos se cancelaron y entregaron y sus ids)
}
