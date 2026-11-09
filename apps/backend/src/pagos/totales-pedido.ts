import { Prisma } from '@prisma/client';

/**
 * HU-022 (BL-494): totales de un pedido con propina.
 *
 * Un único lugar donde se calcula lo que se cobra, para que la tarjeta, el
 * efectivo, el POS y la consulta de cobros pendientes no puedan diverger
 * (BL-90: el monto lo calcula siempre el backend sobre las líneas).
 *
 * - consumo: suma de las líneas, con IVA incluido. Es lo que se factura (CFE)
 *   y lo que usa la rebaja de IVA (Ley 17.934): la propina nunca entra ahí.
 * - propina: la elección del comensal, en pesos enteros.
 * - total: consumo + propina, lo que se cobra.
 */

/** Lo que el comensal eligió; ambos nulos = sin propina. */
export interface EleccionPropina {
  /** Porcentaje del consumo (1 a 100). */
  propinaPorcentaje: number | null;
  /** Monto libre, en pesos enteros (1 o más). */
  propinaMonto: number | null;
}

export interface TotalesPedido {
  consumo: Prisma.Decimal;
  propina: Prisma.Decimal;
  total: Prisma.Decimal;
}

export interface LineaConSubtotal {
  subtotal: Prisma.Decimal;
}

const CERO = new Prisma.Decimal(0);

export function sumarConsumo(lineas: LineaConSubtotal[]): Prisma.Decimal {
  return lineas.reduce(
    (acumulado, linea) => acumulado.plus(linea.subtotal),
    new Prisma.Decimal(0),
  );
}

/**
 * Tope de la propina: el consumo, en pesos enteros (hacia abajo). Una propina
 * del 100 % ya es el máximo que el local puede sugerir en HU-020, así que un
 * tope menor dejaría porcentajes configurables que no se pueden elegir.
 */
export function topeDePropina(consumo: Prisma.Decimal): Prisma.Decimal {
  return consumo.toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN);
}

/**
 * Propina en pesos enteros para un consumo y una elección.
 *
 * - Porcentaje: sobre el consumo con IVA incluido, redondeado al peso con
 *   .5 hacia arriba (15 % de 1250 = 187,5 → 188).
 * - Monto libre: se cobra tal cual, sin pasar el tope.
 * - Sin elección: 0.
 */
export function calcularPropina(
  consumo: Prisma.Decimal,
  eleccion?: Partial<EleccionPropina> | null,
): Prisma.Decimal {
  const tope = topeDePropina(consumo);
  if (eleccion?.propinaPorcentaje != null) {
    const propina = consumo
      .mul(eleccion.propinaPorcentaje)
      .div(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    return Prisma.Decimal.min(propina, tope);
  }
  if (eleccion?.propinaMonto != null) {
    return Prisma.Decimal.min(new Prisma.Decimal(eleccion.propinaMonto), tope);
  }
  return CERO;
}

export function calcularTotales(
  lineas: LineaConSubtotal[],
  eleccion?: Partial<EleccionPropina> | null,
): TotalesPedido {
  const consumo = sumarConsumo(lineas);
  const propina = calcularPropina(consumo, eleccion);
  return { consumo, propina, total: consumo.plus(propina) };
}
