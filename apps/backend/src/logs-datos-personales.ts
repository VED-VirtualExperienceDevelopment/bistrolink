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
] as const;

export const CAMPOS_PERSONALES_EN_LOGS: string[] = CAMPOS.flatMap((campo) => [
  campo,
  `*.${campo}`,
]);
