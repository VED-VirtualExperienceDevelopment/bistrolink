import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * BL-409: RUT de Uruguay (Registro Único Tributario).
 *
 * 12 dígitos: dos de registro (01 a 22), seis de número (no todos cero),
 * `001` y un dígito verificador. El verificador se calcula sobre los 11
 * primeros con pesos 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2 y módulo 11:
 * (−suma) mod 11. Si da 10, ningún RUT con esos 11 dígitos es válido.
 *
 * Mismo algoritmo que python-stdnum (stdnum.uy.rut), que cita el modelo de
 * datos de AGESIC. El frontend tiene una copia en plataforma.utils.ts: si
 * cambia acá, cambia allá.
 */

const PESOS = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

/** Dígito verificador de los 11 primeros dígitos; null si no hay ninguno posible. */
export function digitoVerificadorRut(primeros11: string): number | null {
  let suma = 0;
  for (let i = 0; i < PESOS.length; i++) {
    suma += Number(primeros11[i]) * PESOS[i];
  }
  const digito = (11 - (suma % 11)) % 11;
  return digito === 10 ? null : digito;
}

/** Si el texto es un RUT uruguayo válido (12 dígitos, sin separadores). */
export function esRutValido(rut: unknown): boolean {
  if (typeof rut !== 'string' || !/^\d{12}$/.test(rut)) return false;
  const registro = Number(rut.slice(0, 2));
  if (registro < 1 || registro > 22) return false;
  if (rut.slice(2, 8) === '000000') return false;
  if (rut.slice(8, 11) !== '001') return false;
  return digitoVerificadorRut(rut.slice(0, 11)) === Number(rut[11]);
}

export const MENSAJE_RUT_INVALIDO =
  'rut no es un RUT válido: 12 dígitos sin separadores, terminado en 001 y el dígito verificador';

/** BL-409: decorador de class-validator para los DTO (alta y, después, edición). */
export function EsRutUruguayo(opciones?: ValidationOptions) {
  return (objeto: object, propiedad: string) =>
    registerDecorator({
      name: 'esRutUruguayo',
      target: objeto.constructor,
      propertyName: propiedad,
      options: { message: MENSAJE_RUT_INVALIDO, ...opciones },
      validator: { validate: esRutValido },
    });
}
