import { createHmac } from 'node:crypto';

/**
 * BL-271: nombre y correo del usuario técnico del comensal de un tenant.
 *
 * El backend pide el token del comensal a Keycloak con este usuario (uno
 * por tenant, password grant). Con el nombre `comensal-<tenantId>`, que se
 * deduce del tenantId de la URL del QR, cualquiera podría bloquearlo a
 * propósito cuando se active la protección contra fuerza bruta del realm, y
 * dejar a todo el local sin pedidos. Keycloak no permite excluir usuarios de
 * esa protección, así que el nombre pasa a ser imposible de adivinar:
 * `comensal-` + los primeros 24 caracteres del HMAC-SHA256 del tenantId con
 * un secreto del backend (KEYCLOAK_COMENSAL_USERNAME_SECRET). El backend lo
 * vuelve a calcular cada vez; no se guarda en la base.
 *
 * Transición: sin el secreto se usa el nombre anterior, para que el cambio
 * se pueda desplegar antes de crear los usuarios nuevos. El secreto pasa a
 * ser obligatorio cuando se active la protección contra fuerza bruta.
 *
 * El correo lleva el mismo nombre: el login acepta el correo
 * (`loginWithEmailAllowed`), así que también tiene que ser imposible de
 * adivinar.
 */

export const PREFIJO_COMENSAL_TECNICO = 'comensal-';

/** Dominio ficticio de las cuentas técnicas: nunca se usa para enviar nada. */
export const DOMINIO_EMAIL_TECNICO = 'tecnico.bistrolink.local';

/** 24 caracteres hexadecimales: 96 bits. */
const LARGO_SUFIJO = 24;

export function nombreComensalTecnico(
  tenantId: string,
  secreto: string | undefined = process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET,
): string {
  if (!secreto) {
    return `${PREFIJO_COMENSAL_TECNICO}${tenantId}`;
  }
  const sufijo = createHmac('sha256', secreto)
    .update(tenantId)
    .digest('hex')
    .slice(0, LARGO_SUFIJO);
  return `${PREFIJO_COMENSAL_TECNICO}${sufijo}`;
}

export function emailComensalTecnico(
  tenantId: string,
  secreto: string | undefined = process.env.KEYCLOAK_COMENSAL_USERNAME_SECRET,
): string {
  return `${nombreComensalTecnico(tenantId, secreto)}@${DOMINIO_EMAIL_TECNICO}`;
}
