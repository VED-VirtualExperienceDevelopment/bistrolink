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
}
