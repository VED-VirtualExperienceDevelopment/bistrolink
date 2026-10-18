import { leerNotificacionOrden } from '../../src/pagos/webhooks/notificacion-mercadopago';

describe('leerNotificacionOrden (BL-215)', () => {
  it('toma el id de la order de la query', () => {
    expect(
      leerNotificacionOrden({ type: 'order', 'data.id': 'ORD1' }, undefined),
    ).toBe('ORD1');
  });

  it('si la query no trae datos, usa el cuerpo', () => {
    expect(
      leerNotificacionOrden({}, { type: 'order', data: { id: 'ORD2' } }),
    ).toBe('ORD2');
  });

  it('la query tiene prioridad sobre el cuerpo (es la que se firma)', () => {
    expect(
      leerNotificacionOrden(
        { type: 'order', 'data.id': 'ORD-QUERY' },
        { type: 'order', data: { id: 'ORD-CUERPO' } },
      ),
    ).toBe('ORD-QUERY');
  });

  it('ignora otros tipos de evento', () => {
    expect(
      leerNotificacionOrden({ type: 'payment', 'data.id': '123' }, undefined),
    ).toBeNull();
  });

  it('ignora una notificación sin id', () => {
    expect(
      leerNotificacionOrden({ type: 'order' }, { type: 'order' }),
    ).toBeNull();
  });
});
