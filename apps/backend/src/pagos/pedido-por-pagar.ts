import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Validaciones comunes de todo lo que opera sobre un pedido que espera el
 * pago (la propina, el cobro del personal): que exista (404), que no esté
 * cancelado (409) y que no se haya pagado ya (409).
 *
 * Devuelve el mismo pedido, ya sin `null`, para poder encadenarla con la
 * lectura. Las validaciones propias de cada operación (un pago con tarjeta en
 * curso, por ejemplo, que tiene un mensaje distinto en cada una) quedan donde
 * se usan.
 */
export function exigirPedidoPorPagar<T extends { estado: string }>(
  pedido: T | null | undefined,
): T {
  if (!pedido) {
    throw new NotFoundException('Pedido no encontrado');
  }
  if (pedido.estado === 'CANCELADO') {
    throw new ConflictException('El pedido está cancelado');
  }
  if (pedido.estado !== 'PENDIENTE_PAGO') {
    throw new ConflictException('Este pedido ya fue pagado');
  }
  return pedido;
}
