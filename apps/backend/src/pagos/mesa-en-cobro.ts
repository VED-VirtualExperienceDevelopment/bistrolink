import { PrismaClient } from '@prisma/client';

/**
 * HU-017 (BL-60): termina un cobro (aprobado, rechazado o vencido) y la mesa
 * sale de EN_PROCESO_DE_PAGO, salvo que otro comensal de la misma mesa
 * todavía tenga un pago PENDIENTE: la mesa es una sola, pero cada pedido
 * tiene su propio pago. Así el mapa no la muestra «Ocupada» con un cobro en
 * curso.
 *
 * Se llama dentro de la transacción que resolvió el pago, DESPUÉS de sacarlo
 * de PENDIENTE (si no, se contaría a sí mismo).
 *
 * Primero bloquea la fila de la mesa (SELECT … FOR UPDATE) hasta el fin de
 * la transacción: si dos cobros de la misma mesa terminan a la vez, el
 * segundo espera al primero y, al contar, ya ve su pago resuelto. Sin el
 * bloqueo cada uno vería el pago del otro todavía PENDIENTE y la mesa
 * quedaría amarilla sin ningún cobro en curso.
 *
 * @returns true si la mesa volvió a OCUPADA (hay que avisar al mapa).
 */
export async function liberarMesaDelCobro(
  tx: PrismaClient,
  mesaId: string,
): Promise<boolean> {
  await tx.$queryRaw`SELECT 1 FROM "mesa" WHERE "id" = ${mesaId}::uuid FOR UPDATE`;

  const otrosEnCurso = await tx.pago.count({
    where: { estado: 'PENDIENTE', pedido: { mesaId } },
  });
  if (otrosEnCurso > 0) return false;

  // Condicional: una notificación tardía no mueve una mesa que ya siguió su
  // curso (por ejemplo, que se cerró).
  const { count } = await tx.mesa.updateMany({
    where: { id: mesaId, estado: 'EN_PROCESO_DE_PAGO' },
    data: { estado: 'OCUPADA' },
  });
  return count > 0;
}
