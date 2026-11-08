/**
 * HU-036 (BL-206): campos con datos personales que Pino reemplaza por
 * [REDACTED] si aparecen en un log, en la raíz del objeto o un nivel abajo
 * (por ejemplo, `{ datosPasarela: { payerEmail } }`). Hoy ningún log los
 * escribe a propósito: esto evita que un log nuevo los deje en texto plano.
 *
 * Pino no acepta comodines intermedios de profundidad variable, por eso se
 * listan los dos niveles.
 */
const CAMPOS = [
  'email',
  'payerEmail',
  'password',
  'rut',
  'razonSocial',
  'telefono',
  'identificationNumber',
  'documento',
  'emailPrivacidad',
  // HU-009 (BL-453): receptor de la e-Factura (en el pedido y en Surtec).
  'receptorRut',
  'receptorRazonSocial',
  'nro_doc',
  'denominacion',
] as const;

export const CAMPOS_PERSONALES_EN_LOGS: string[] = CAMPOS.flatMap((campo) => [
  campo,
  `*.${campo}`,
]);

/**
 * BL-214: la IP pública de quien hace el request. Detrás del proxy de
 * Railway llega en estas cabeceras, y el log "request completed" guarda
 * las cabeceras del request, así que la IP terminaba en stdout y en Loki.
 * La IP es un dato personal (Ley 18.331) y la política de privacidad dice
 * que los registros técnicos no los guardan.
 *
 * No afecta al registro de auditoría (HU-035): ese toma la IP del request
 * directamente (audit-log/contexto-auditoria.ts), no de los logs.
 */
export const CABECERAS_CON_IP_EN_LOGS: string[] = [
  'req.headers["x-forwarded-for"]',
  'req.headers["x-real-ip"]',
];
