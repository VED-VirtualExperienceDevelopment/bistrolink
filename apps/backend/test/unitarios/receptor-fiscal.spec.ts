import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  normalizarRazonSocial,
  normalizarRut,
  receptorParaGuardar,
} from '../../src/cfe/receptor-fiscal';
import { CrearPagoDto } from '../../src/pagos/dto/crear-pago.dto';
import { SolicitarEfectivoDto } from '../../src/pagos/efectivo/solicitar-efectivo.dto';

// HU-009 (BL-453): datos del receptor de la e-Factura. RUT de ejemplo con
// dígito verificador válido (no son de contribuyentes reales a propósito).
const RUT = '219999830019';
const AHORA = new Date('2026-11-02T15:00:00Z');

describe('receptorParaGuardar (HU-009, BL-453)', () => {
  const valido = {
    rut: '21 999983 0019',
    razonSocial: '  Comensal   Ejemplo SAS ',
    consentimiento: true,
  };

  it('datos válidos con consentimiento: guarda RUT normalizado, razón social y fecha del consentimiento', () => {
    expect(receptorParaGuardar(valido, AHORA)).toEqual({
      receptorRut: RUT,
      receptorRazonSocial: 'Comensal Ejemplo SAS',
      receptorConsentidoEn: AHORA,
    });
  });

  it('sin el campo: no toca el pedido', () => {
    expect(receptorParaGuardar(undefined, AHORA)).toBeUndefined();
  });

  const SIN_RECEPTOR = {
    receptorRut: null,
    receptorRazonSocial: null,
    receptorConsentidoEn: null,
  };

  it.each([
    ['null (sacó el pedido de e-Factura)', null],
    ['sin aceptar el aviso', { ...valido, consentimiento: false }],
    [
      'RUT con dígito verificador incorrecto',
      { ...valido, rut: '219999830018' },
    ],
    ['RUT incompleto', { ...valido, rut: '2199998' }],
    ['razón social vacía', { ...valido, razonSocial: '   ' }],
  ])('%s: no guarda nada (se emite un e-Ticket)', (_caso, receptor) => {
    expect(receptorParaGuardar(receptor, AHORA)).toEqual(SIN_RECEPTOR);
  });

  it('normaliza el RUT y la razón social', () => {
    expect(normalizarRut('21.999983-001-9')).toBe(RUT);
    expect(normalizarRazonSocial(' A   B ')).toBe('A B');
  });
});

describe('receptorFiscal en los DTO de pago (HU-009, BL-453)', () => {
  const pago = {
    idempotencyKey: 'pago-001',
    medioPago: 'MERCADOPAGO',
    datosPasarela: { token: 'tok' },
  };
  const errores = async (cls: any, datos: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, datos))).map((e) => e.property);

  it.each([
    ['sin receptor', {}],
    ['receptor null', { receptorFiscal: null }],
    [
      'receptor completo',
      {
        receptorFiscal: {
          rut: RUT,
          razonSocial: 'Ejemplo SAS',
          consentimiento: true,
        },
      },
    ],
    [
      // El DTO no decide si alcanza para una e-Factura: lo hace
      // receptorParaGuardar, que emite un e-Ticket en lugar de rechazar el pago.
      'RUT inválido (no bloquea el pago)',
      {
        receptorFiscal: { rut: '123', razonSocial: 'X', consentimiento: false },
      },
    ],
  ])('%s: válido', async (_caso, extra) => {
    expect(await errores(CrearPagoDto, { ...pago, ...extra })).toEqual([]);
    expect(await errores(SolicitarEfectivoDto, extra)).toEqual([]);
  });

  it.each([
    ['sin consentimiento', { rut: RUT, razonSocial: 'X' }],
    [
      'razón social de más de 150',
      { rut: RUT, razonSocial: 'x'.repeat(151), consentimiento: true },
    ],
    ['tipos incorrectos', { rut: 21, razonSocial: [], consentimiento: 'si' }],
  ])('%s: rechaza receptorFiscal', async (_caso, receptorFiscal) => {
    expect(await errores(CrearPagoDto, { ...pago, receptorFiscal })).toEqual([
      'receptorFiscal',
    ]);
    expect(await errores(SolicitarEfectivoDto, { receptorFiscal })).toEqual([
      'receptorFiscal',
    ]);
  });
});
