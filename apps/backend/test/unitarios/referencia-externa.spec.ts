import {
  armarReferenciaExterna,
  leerReferenciaExterna,
} from '../../src/pagos/webhooks/referencia-externa';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const PEDIDO_ID = '3cdf1dad-31d6-43c9-9739-11485e0e23f8';

describe('referencia externa (tenant + pedido dentro del external_reference de Mercado Pago)', () => {
  it('lo que se arma se lee de vuelta: ida y vuelta sin pérdida', () => {
    const referencia = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

    expect(leerReferenciaExterna(referencia)).toEqual({
      tenantId: TENANT_ID,
      pedidoId: PEDIDO_ID,
    });
  });

  it('cumple las reglas de Mercado Pago: hasta 64 caracteres y solo letras, números, guiones y guiones bajos', () => {
    const referencia = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

    expect(referencia.length).toBeLessThanOrEqual(64);
    expect(referencia).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('funciona con cualquier UUID (incluidos los que producen "-" y "_" en base64url)', () => {
    for (let i = 0; i < 200; i++) {
      const hex = () =>
        Math.floor(Math.random() * 0xffffffff)
          .toString(16)
          .padStart(8, '0');
      const uuid = (): string =>
        `${hex()}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
      const tenantId = uuid();
      const pedidoId = uuid();

      const referencia = armarReferenciaExterna(tenantId, pedidoId);

      expect(referencia).toMatch(/^[A-Za-z0-9_-]{46}$/);
      expect(leerReferenciaExterna(referencia)).toEqual({ tenantId, pedidoId });
    }
  });

  it('distintos pedidos o tenants dan referencias distintas', () => {
    const base = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

    expect(
      armarReferenciaExterna(TENANT_ID, '00000000-0000-0000-0000-000000000001'),
    ).not.toBe(base);
    expect(
      armarReferenciaExterna('22222222-2222-2222-2222-222222222222', PEDIDO_ID),
    ).not.toBe(base);
  });

  it('armar con algo que no es UUID lanza error', () => {
    expect(() => armarReferenciaExterna('no-es-uuid', PEDIDO_ID)).toThrow();
    expect(() => armarReferenciaExterna(TENANT_ID, 'tampoco')).toThrow();
  });

  describe('leer referencias que NO son de BistroLink (orders ajenas o viejas)', () => {
    it.each([
      ['undefined', undefined],
      ['vacía', ''],
      ['formato viejo de las pruebas', `pedido-${PEDIDO_ID}`],
      ['texto cualquiera', 'ext_ref_1234'],
      ['largo correcto pero sin la versión', 'x'.repeat(46)],
      ['versión correcta pero cuerpo inválido', `v1${'!'.repeat(44)}`],
      ['demasiado corta', 'v1abc'],
    ])('%s => null', (_caso, referencia) => {
      expect(leerReferenciaExterna(referencia)).toBeNull();
    });

    it('una referencia con un byte de más o de menos => null', () => {
      const referencia = armarReferenciaExterna(TENANT_ID, PEDIDO_ID);

      expect(leerReferenciaExterna(referencia + 'A')).toBeNull();
      expect(leerReferenciaExterna(referencia.slice(0, -1))).toBeNull();
    });
  });
});
