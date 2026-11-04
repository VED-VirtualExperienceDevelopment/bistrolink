/**
 * BL-409: RUT de Uruguay. Copia de apps/backend/src/plataforma/rut.ts (el
 * backend es quien decide; esto da el error antes y más claro). Si cambia
 * allá, cambia acá. La usan el alta de establecimientos (BL-409) y la
 * e-Factura del comensal (HU-009, BL-453).
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
