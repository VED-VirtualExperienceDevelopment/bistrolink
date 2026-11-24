import { ConflictException, NotFoundException } from '@nestjs/common';
import { exigirPedidoPorPagar } from '../../src/pagos/pedido-por-pagar';

describe('exigirPedidoPorPagar (HU-022, BL-494)', () => {
  it.each([[null], [undefined]])('pedido inexistente (%s): 404', (pedido) => {
    expect(() => exigirPedidoPorPagar(pedido)).toThrow(
      new NotFoundException('Pedido no encontrado'),
    );
  });

  it('pedido cancelado: 409', () => {
    expect(() => exigirPedidoPorPagar({ estado: 'CANCELADO' })).toThrow(
      new ConflictException('El pedido está cancelado'),
    );
  });

  it.each([['RECIBIDO'], ['EN_PREPARACION'], ['ENTREGADO']])(
    'pedido %s (ya pagado): 409',
    (estado) => {
      expect(() => exigirPedidoPorPagar({ estado })).toThrow(
        new ConflictException('Este pedido ya fue pagado'),
      );
    },
  );

  it('pedido esperando el pago: devuelve el mismo pedido', () => {
    const pedido = { estado: 'PENDIENTE_PAGO', id: 'p-1' };

    expect(exigirPedidoPorPagar(pedido)).toBe(pedido);
  });
});
