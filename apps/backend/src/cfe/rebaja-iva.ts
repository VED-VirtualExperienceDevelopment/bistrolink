import { Prisma } from '@prisma/client';

/**
 * HU-037 (BL-207): rebaja de IVA por pago electrónico en servicios
 * gastronómicos (Ley 17.934).
 *
 * BistroLink NO aplica el descuento: el CFE se emite por el total, sin
 * descontar nada, y la rebaja la aplica la administradora del medio de pago
 * en su liquidación. Lo que hace BistroLink es:
 * - saber cuándo aplica (pago electrónico de un consumo en el local);
 * - calcular el monto informativo (total sin reducción, reducción y neto) y
 *   mostrarlo con la leyenda, como pide DGI para el comprobante del pago;
 * - poner la leyenda en la adenda del e-Ticket.
 *
 * Fuente: guía de DGI «Reducción de 9 puntos de IVA en determinados
 * servicios siempre que sean abonados a través de medios electrónicos de
 * pago» (Decreto 235/026, vigente desde el 01/10/2026). La rebaja se
 * prorroga por decreto: antes del piloto se valida con el contador del local
 * o con DGI.
 */

export const LEYENDA_REBAJA_17934 = 'Reducción IVA Ley N° 17.934';

// Sin una nueva prórroga, la rebaja baja a 5 puntos (anunciado por el MEF
// junto con el Decreto 235/026). Revisar antes del 30/04/2027.
const SIN_PRORROGA = {
  hasta: null,
  puntos: 5,
  norma: 'sin prórroga de los 9 puntos',
} as const;

/**
 * Puntos de IVA que se rebajan según la fecha de la operación. La tabla va
 * en el código (y no en una variable de entorno) para que cada prórroga
 * quede en el historial con su decreto: una prórroga nueva es cambiar o
 * agregar una fila.
 *
 * `hasta` es el último día incluido, en hora de Uruguay. La última fila no
 * tiene `hasta`: es lo que rige si no hay prórroga.
 */
export const VIGENCIAS_REBAJA_17934: readonly {
  hasta: string | null;
  puntos: number;
  norma: string;
}[] = [
  { hasta: '2027-04-30', puntos: 9, norma: 'Decreto 235/026' },
  SIN_PRORROGA,
];

/** IVA básico (22 %): los ítems del e-Ticket van con tasa básica (CfeService). */
const IVA_BASICO = new Prisma.Decimal('0.22');

/**
 * Pasarelas que cobran con tarjeta o dinero electrónico. EFECTIVO no tiene
 * beneficio.
 */
const MEDIOS_ELECTRONICOS: ReadonlySet<string> = new Set([
  'MERCADOPAGO',
  'PLEXO',
]);

/**
 * Canales en los que el pedido se consume en el local (servicio
 * gastronómico): la mesa (QR) y el pedido que carga el mozo. Un pedido para
 * retirar (WEB) no entra en la Ley 17.934; ahí corresponde la rebaja general
 * de la Ley 19.210, que aplica sola la administradora.
 */
const CANALES_EN_EL_LOCAL: ReadonlySet<string> = new Set(['QR', 'MOZO']);

export interface RebajaIva {
  ley: '17.934';
  puntos: number;
  /** Importe total de la operación, sin la reducción (el del CFE). */
  totalSinReduccion: string;
  /** Monto que descuenta la administradora. */
  reduccion: string;
  /** Total neto de la reducción. */
  neto: string;
  leyenda: string;
}

/** Fecha de la operación en Uruguay, como AAAA-MM-DD. */
function fechaEnUruguay(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

export function puntosRebajaVigentes(fecha: Date): number {
  const dia = fechaEnUruguay(fecha);
  // La última fila (SIN_PRORROGA) no tiene `hasta`: siempre hay una vigente.
  const vigente =
    VIGENCIAS_REBAJA_17934.find((v) => v.hasta === null || dia <= v.hasta) ??
    SIN_PRORROGA;
  return vigente.puntos;
}

/** ¿El pago tiene la rebaja de la Ley 17.934? */
export function aplicaRebaja17934(pago: {
  canal: string;
  medioPago: string;
  estado: string;
}): boolean {
  return (
    CANALES_EN_EL_LOCAL.has(pago.canal) &&
    MEDIOS_ELECTRONICOS.has(pago.medioPago) &&
    (pago.estado === 'APROBADO' || pago.estado === 'REEMBOLSADO')
  );
}

/**
 * Monto informativo de la rebaja. El total incluye el IVA básico; la
 * reducción es `puntos` sobre el importe sin IVA:
 *
 *   $ 1.220 = $ 1.000 + IVA $ 220 → 9 puntos de $ 1.000 = $ 90.
 *
 * Si solo una parte se pagó con medios electrónicos, la reducción es
 * proporcional a esa parte. Se redondea a centésimos (NUMERIC(10,2)).
 */
export function calcularRebaja17934(params: {
  total: Prisma.Decimal | string | number;
  fecha: Date;
  /** Lo pagado con medios electrónicos; por defecto, todo el total. */
  montoElectronico?: Prisma.Decimal | string | number;
}): RebajaIva {
  const total = new Prisma.Decimal(params.total);
  const electronico = new Prisma.Decimal(params.montoElectronico ?? total);
  const puntos = puntosRebajaVigentes(params.fecha);

  const proporcion = total.isZero()
    ? new Prisma.Decimal(0)
    : Prisma.Decimal.min(electronico, total).div(total);
  const reduccion = total
    .div(IVA_BASICO.plus(1))
    .mul(puntos)
    .div(100)
    .mul(proporcion)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    ley: '17.934',
    puntos,
    totalSinReduccion: total.toFixed(2),
    reduccion: reduccion.toFixed(2),
    neto: total.minus(reduccion).toFixed(2),
    leyenda: LEYENDA_REBAJA_17934,
  };
}
