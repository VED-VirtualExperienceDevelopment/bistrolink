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
  // HU-040 (BL-210): nombre y contacto del pedido para retirar (en el
  // pedido y en el body de POST /pedidos, que se oculta entero).
  'retiroNombre',
  'retiroContacto',
  'contactoRetiro',
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

/**
 * BL-572: tokens que dan acceso a un pedido, a una mesa o a un pago y que
 * llegan en cabeceras propias. El log «request completed» guarda las
 * cabeceras del request, así que terminaban en stdout y en Loki igual que
 * `authorization`, que ya se oculta en app.module.ts. Con un token vigente
 * se puede ver o pagar ese pedido (OWASP ASVS 7.1.1).
 *
 * Los nombres son los de HEADER_PEDIDO_TOKEN (pedidos/token-acceso-pedido),
 * HEADER_MESA_TOKEN y HEADER_MESA_SESION (qr-mesa/mesa-qr.guard) y
 * HEADER_LINK_PAGO (link-pago/link-pago). Se escriben acá para no importar
 * esos módulos desde la configuración del logger.
 */
export const CABECERAS_CON_TOKENS_EN_LOGS: string[] = [
  'req.headers["x-pedido-token"]',
  'req.headers["x-mesa-token"]',
  'req.headers["x-mesa-sesion"]',
  'req.headers["x-link-pago"]',
];
