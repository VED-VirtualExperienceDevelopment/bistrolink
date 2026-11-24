import { Prisma } from '@prisma/client';
import {
  calcularPropina,
  calcularTotales,
  sumarConsumo,
  topeDePropina,
  totalCobrado,
} from '../../src/pagos/totales-pedido';

// HU-022 (BL-494, BL-85): totales de un pedido con propina.

const linea = (subtotal: string) => ({
  subtotal: new Prisma.Decimal(subtotal),
});
const pesos = (valor: Prisma.Decimal) => valor.toFixed(2);

describe('totales de un pedido con propina (HU-022)', () => {
  describe('sumarConsumo', () => {
    it('suma los subtotales de las líneas', () => {
      expect(pesos(sumarConsumo([linea('800'), linea('450.50')]))).toBe(
        '1250.50',
      );
    });

    it('sin líneas, el consumo es 0', () => {
      expect(pesos(sumarConsumo([]))).toBe('0.00');
    });
  });

  describe('calcularTotales', () => {
    const lineas = [linea('800'), linea('450')]; // consumo $ 1.250

    it('sin elección: sin propina, el total es el consumo', () => {
      const t = calcularTotales(lineas);
      expect(pesos(t.consumo)).toBe('1250.00');
      expect(pesos(t.propina)).toBe('0.00');
      expect(pesos(t.total)).toBe('1250.00');
    });

    it('elección con ambos campos nulos: sin propina', () => {
      const t = calcularTotales(lineas, {
        propinaPorcentaje: null,
        propinaMonto: null,
      });
      expect(pesos(t.propina)).toBe('0.00');
      expect(pesos(t.total)).toBe('1250.00');
    });

    it('por porcentaje: 10 % de $ 1.250 = $ 125', () => {
      const t = calcularTotales(lineas, { propinaPorcentaje: 10 });
      expect(pesos(t.propina)).toBe('125.00');
      expect(pesos(t.total)).toBe('1375.00');
    });

    it('por porcentaje redondea al peso con .5 hacia arriba: 15 % de $ 1.250 = $ 188', () => {
      const t = calcularTotales(lineas, { propinaPorcentaje: 15 });
      expect(pesos(t.propina)).toBe('188.00');
      expect(pesos(t.total)).toBe('1438.00');
    });

    it('25 % de $ 1.250 = 312,5 → $ 313', () => {
      const t = calcularTotales(lineas, { propinaPorcentaje: 25 });
      expect(pesos(t.propina)).toBe('313.00');
    });

    it('por monto libre: se cobra tal cual', () => {
      const t = calcularTotales(lineas, { propinaMonto: 200 });
      expect(pesos(t.propina)).toBe('200.00');
      expect(pesos(t.total)).toBe('1450.00');
    });

    it('la propina no cambia el consumo (es lo que se factura)', () => {
      const sin = calcularTotales(lineas);
      const con = calcularTotales(lineas, { propinaPorcentaje: 20 });
      expect(pesos(con.consumo)).toBe(pesos(sin.consumo));
    });

    it('consumo con centavos: el porcentaje se calcula sobre el consumo exacto', () => {
      // 10 % de 1250,50 = 125,05 → $ 125
      const t = calcularTotales([linea('1250.50')], { propinaPorcentaje: 10 });
      expect(pesos(t.propina)).toBe('125.00');
      expect(pesos(t.total)).toBe('1375.50');
    });
  });

  describe('tope', () => {
    it('el tope es el consumo en pesos enteros, hacia abajo', () => {
      expect(pesos(topeDePropina(new Prisma.Decimal('1250.90')))).toBe(
        '1250.00',
      );
    });

    it('100 % del consumo llega justo al tope', () => {
      const consumo = new Prisma.Decimal('1250');
      expect(pesos(calcularPropina(consumo, { propinaPorcentaje: 100 }))).toBe(
        '1250.00',
      );
    });

    it('un monto libre mayor al consumo no pasa del tope', () => {
      const consumo = new Prisma.Decimal('1250');
      expect(pesos(calcularPropina(consumo, { propinaMonto: 5000 }))).toBe(
        '1250.00',
      );
    });
  });

  describe('totalCobrado', () => {
    it('suma el consumo y la propina del pago', () => {
      const pago = {
        monto: new Prisma.Decimal('1250'),
        propina: new Prisma.Decimal('188'),
      };
      expect(pesos(totalCobrado(pago))).toBe('1438.00');
    });

    it('un pago sin propina (anterior a HU-022) cobra solo el monto', () => {
      const monto = new Prisma.Decimal('590');
      expect(pesos(totalCobrado({ monto }))).toBe('590.00');
      expect(pesos(totalCobrado({ monto, propina: null }))).toBe('590.00');
    });
  });
});
