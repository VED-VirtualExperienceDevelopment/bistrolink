import {
  aplicaRebaja17934,
  calcularRebaja17934,
  PUNTOS_SIN_PRORROGA,
  puntosRebajaVigentes,
  VIGENCIAS_REBAJA_17934,
} from '../../src/cfe/rebaja-iva';

// HU-037 (BL-207): rebaja de IVA por pago electrónico (Ley 17.934).

const NOVIEMBRE_2026 = new Date('2026-11-01T15:00:00Z');

describe('rebaja de IVA de la Ley 17.934 (HU-037, BL-207)', () => {
  describe('calcularRebaja17934', () => {
    it('ejemplo de DGI: $ 1.220 con IVA básico => reducción $ 90 y neto $ 1.130', () => {
      expect(
        calcularRebaja17934({ total: '1220', fecha: NOVIEMBRE_2026 }),
      ).toEqual({
        ley: '17.934',
        puntos: 9,
        totalSinReduccion: '1220.00',
        reduccion: '90.00',
        neto: '1130.00',
        leyenda: 'Reducción IVA Ley N° 17.934',
      });
    });

    it('pago mixto: la mitad con tarjeta => la mitad de la reducción ($ 45)', () => {
      expect(
        calcularRebaja17934({
          total: '1220',
          montoElectronico: '610',
          fecha: NOVIEMBRE_2026,
        }),
      ).toMatchObject({ reduccion: '45.00', neto: '1175.00' });
    });

    it('redondea a centésimos (NUMERIC(10,2)): $ 590 => $ 43,52', () => {
      // 590 / 1,22 = 483,6066 → 9 % = 43,5246 → 43,52
      expect(
        calcularRebaja17934({ total: '590', fecha: NOVIEMBRE_2026 }),
      ).toMatchObject({ reduccion: '43.52', neto: '546.48' });
    });

    it('lo pagado con tarjeta nunca supera el total, y un total en cero no divide por cero', () => {
      expect(
        calcularRebaja17934({
          total: '1220',
          montoElectronico: '5000',
          fecha: NOVIEMBRE_2026,
        }).reduccion,
      ).toBe('90.00');
      expect(
        calcularRebaja17934({ total: '0', fecha: NOVIEMBRE_2026 }).reduccion,
      ).toBe('0.00');
    });
  });

  describe('puntosRebajaVigentes (cambia por decreto)', () => {
    it('9 puntos hasta el 30/04/2027 inclusive, en hora de Uruguay (Decreto 235/026)', () => {
      expect(puntosRebajaVigentes(NOVIEMBRE_2026)).toBe(9);
      // 30/04/2027 23:30 en Uruguay = 01/05/2027 02:30 UTC.
      expect(puntosRebajaVigentes(new Date('2027-05-01T02:30:00Z'))).toBe(9);
    });

    it('sin prórroga, desde el 01/05/2027 son 5 puntos', () => {
      expect(puntosRebajaVigentes(new Date('2027-05-01T03:00:00Z'))).toBe(5);
      expect(
        calcularRebaja17934({
          total: '1220',
          fecha: new Date('2027-06-01T15:00:00Z'),
        }),
      ).toMatchObject({ puntos: 5, reduccion: '50.00', neto: '1170.00' });
    });

    it('la tabla de vigencias está ordenada por fecha (la primera que cubre el día es la que rige)', () => {
      const fechas = VIGENCIAS_REBAJA_17934.map((v) => v.hasta);
      expect([...fechas].sort()).toEqual(fechas);
      expect(PUNTOS_SIN_PRORROGA).toBe(5);
    });
  });

  describe('aplicaRebaja17934', () => {
    it.each([
      ['QR', 'MERCADOPAGO', 'APROBADO', true],
      ['MOZO', 'MERCADOPAGO', 'APROBADO', true],
      ['QR', 'MERCADOPAGO', 'REEMBOLSADO', true],
      ['QR', 'EFECTIVO', 'APROBADO', false],
      ['WEB', 'MERCADOPAGO', 'APROBADO', false],
      ['QR', 'MERCADOPAGO', 'PENDIENTE', false],
      ['QR', 'MERCADOPAGO', 'RECHAZADO', false],
    ])('canal %s, %s, %s => %s', (canal, medioPago, estado, esperado) => {
      expect(aplicaRebaja17934({ canal, medioPago, estado })).toBe(esperado);
    });
  });
});
