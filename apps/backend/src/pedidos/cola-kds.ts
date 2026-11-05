import { PedidoEstado, PrismaClient } from '@prisma/client';

/**
 * HU-042 (BL-463, ADR 0010): cola del KDS y límite de pedidos en preparación.
 *
 * La cola es el estado del pedido: RECIBIDO = «en espera». No hay tabla ni
 * estado en memoria aparte. Con `restaurante.limite_pedidos_en_preparacion`
 * en null la cola automática está desactivada y nada cambia.
 *
 * Todo corre DENTRO de la transacción de quien llama (runInTenantContext):
 * el RLS limita las consultas al tenant y el lock se libera solo al
 * terminar la transacción, aunque el proceso se caiga a mitad de camino.
 */

/** Un pedido que la cola pasó a EN_PREPARACION, con la forma de `pedido:actualizado`. */
export interface PedidoPromovido {
  id: string;
  estado: PedidoEstado;
  actualizadoEn: string;
  mesaNumero: number;
  // BL-66: solo id, nombre y cantidad. Nunca precios.
  lineas: { id: string; nombreSnapshot: string; cantidad: number }[];
}

/** Límite del local, o null si la cola automática está desactivada. */
export async function limiteDeLaCola(
  tx: PrismaClient,
  tenantId: string,
): Promise<number | null> {
  // Un tenant tiene un solo restaurante (tenantId es @unique).
  const restaurante = await tx.restaurante.findUnique({
    where: { tenantId },
    select: { limitePedidosEnPreparacion: true },
  });
  return restaurante?.limitePedidosEnPreparacion ?? null;
}

/**
 * Serializa las operaciones de cola del mismo local: dos pagos aprobados a
 * la vez no pueden ver los dos el mismo lugar libre. Otros locales no se
 * bloquean. La clave sale del tenantId del token, nunca de datos del cliente.
 */
export async function bloquearColaDelTenant(
  tx: PrismaClient,
  tenantId: string,
): Promise<void> {
  const clave = `kds-cola:${tenantId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))`;
}

/** Pedidos en preparación ahora. Llamar con el lock tomado. */
export function contarEnPreparacion(
  tx: PrismaClient,
  tenantId: string,
): Promise<number> {
  return tx.pedido.count({
    where: { tenantId, estado: PedidoEstado.EN_PREPARACION },
  });
}

/**
 * Llena los lugares libres de la cocina con los pedidos más antiguos de la
 * cola (FIFO por encolado_en; los pedidos anteriores a HU-042 no lo tienen
 * y van primero, por created_at). Devuelve los que pasaron a
 * EN_PREPARACION para avisar al KDS y al comensal después del commit.
 *
 * Se llama al aprobarse un pago (el pedido recién llegado está en la cola)
 * y al pasar un pedido a LISTO_PARA_ENTREGAR (se liberó un lugar).
 *
 * La promoción es automática: el historial queda sin usuario, igual que
 * la confirmación del pago por la pasarela.
 */
export async function completarCapacidad(
  tx: PrismaClient,
  tenantId: string,
): Promise<PedidoPromovido[]> {
  const limite = await limiteDeLaCola(tx, tenantId);
  if (limite === null) {
    return [];
  }

  await bloquearColaDelTenant(tx, tenantId);

  const libres = limite - (await contarEnPreparacion(tx, tenantId));
  if (libres <= 0) {
    return [];
  }

  const siguientes = await tx.pedido.findMany({
    where: { tenantId, estado: PedidoEstado.RECIBIDO },
    orderBy: [
      { encoladoEn: { sort: 'asc', nulls: 'first' } },
      { createdAt: 'asc' },
    ],
    take: libres,
    select: { id: true },
  });

  const promovidos: PedidoPromovido[] = [];
  for (const { id } of siguientes) {
    // Solo si sigue en RECIBIDO: nunca pisa un cambio que llegó antes.
    const { count } = await tx.pedido.updateMany({
      where: { id, estado: PedidoEstado.RECIBIDO },
      data: { estado: PedidoEstado.EN_PREPARACION },
    });
    if (count === 0) {
      continue;
    }

    await tx.pedidoEstadoHistorial.create({
      data: {
        tenantId,
        pedidoId: id,
        usuarioId: null,
        estadoAnterior: PedidoEstado.RECIBIDO,
        estadoNuevo: PedidoEstado.EN_PREPARACION,
      },
    });

    const pedido = await tx.pedido.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        estado: true,
        updatedAt: true,
        mesa: { select: { numero: true } },
        lineas: {
          select: { id: true, nombreSnapshot: true, cantidad: true },
        },
      },
    });

    promovidos.push({
      id: pedido.id,
      estado: pedido.estado,
      actualizadoEn: pedido.updatedAt.toISOString(),
      mesaNumero: pedido.mesa.numero,
      lineas: pedido.lineas,
    });
  }

  return promovidos;
}
