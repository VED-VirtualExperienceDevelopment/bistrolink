import { PedidoEstado, Prisma, PrismaClient } from '@prisma/client';

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

/**
 * HU-042 (BL-464): orden de la cola. FIFO por encolado_en; los pedidos
 * anteriores a HU-042 no lo tienen y van primero, por created_at.
 */
const ORDEN_COLA: Prisma.PedidoOrderByWithRelationInput[] = [
  { encoladoEn: { sort: 'asc', nulls: 'first' } },
  { createdAt: 'asc' },
];

/** HU-042 (BL-464): lugar de un pedido en la cola, para su comensal. */
export interface PosicionEnCola {
  pedidoId: string;
  /** 1 = el próximo en pasar a preparación. */
  posicion: number;
  minutosEstimados: number;
}

/**
 * HU-042 (BL-464): estado de la cola para el KDS (`cola:actualizada`).
 * `orden` tiene la posición y el tiempo de cada pedido en espera: el KDS lo
 * usa para numerarlos y el gateway para avisar a cada comensal el suyo.
 */
export interface EstadoCola {
  activa: boolean;
  limite: number | null;
  enPreparacion: number;
  enEspera: number;
  umbralAlerta: number;
  altaDemanda: boolean;
  /** Tiempo estimado para un pedido que llega ahora. */
  minutosEstimados: number;
  orden: PosicionEnCola[];
}

/**
 * HU-042 (BL-464, ADR 0010): tiempo estimado hasta que el pedido sale de
 * cocina. `posicion` 0 = ya en preparación. Crece con la cola, así que con
 * alta demanda sube solo, sin un multiplicador aparte. Redondea hacia arriba
 * para no prometer menos de lo real.
 */
export function calcularMinutosEstimados(
  posicion: number,
  limite: number,
  minutosReferencia: number,
): number {
  return Math.ceil(minutosReferencia * (1 + posicion / limite));
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

  // Con el lock tomado nadie más mueve la cola de este local: los pedidos
  // elegidos siguen en RECIBIDO hasta el update de abajo. Tres consultas en
  // total, sin importar cuántos lugares se liberen (sin await en un loop).
  const siguientes = await tx.pedido.findMany({
    where: { tenantId, estado: PedidoEstado.RECIBIDO },
    orderBy: ORDEN_COLA,
    take: libres,
    select: {
      id: true,
      mesa: { select: { numero: true } },
      lineas: {
        select: { id: true, nombreSnapshot: true, cantidad: true },
      },
    },
  });
  if (siguientes.length === 0) {
    return [];
  }

  const ids = siguientes.map((pedido) => pedido.id);
  const ahora = new Date();
  await tx.pedido.updateMany({
    where: { id: { in: ids }, estado: PedidoEstado.RECIBIDO },
    data: { estado: PedidoEstado.EN_PREPARACION, updatedAt: ahora },
  });
  await tx.pedidoEstadoHistorial.createMany({
    data: ids.map((pedidoId) => ({
      tenantId,
      pedidoId,
      usuarioId: null,
      estadoAnterior: PedidoEstado.RECIBIDO,
      estadoNuevo: PedidoEstado.EN_PREPARACION,
    })),
  });

  // En el orden de la cola (FIFO), como los devolvió el findMany.
  return siguientes.map((pedido) => ({
    id: pedido.id,
    estado: PedidoEstado.EN_PREPARACION,
    actualizadoEn: ahora.toISOString(),
    mesaNumero: pedido.mesa.numero,
    lineas: pedido.lineas,
  }));
}

/**
 * HU-042 (BL-464): foto de la cola para el KDS y los comensales. Solo lee:
 * no toma el lock. Con la cola desactivada devuelve `activa: false` y la
 * lista vacía.
 */
export async function estadoDeLaCola(
  tx: PrismaClient,
  tenantId: string,
): Promise<EstadoCola> {
  const restaurante = await tx.restaurante.findUnique({
    where: { tenantId },
    select: {
      limitePedidosEnPreparacion: true,
      umbralAlertaCola: true,
      minutosPreparacionEstimados: true,
    },
  });
  // Mismos valores por defecto que la migración.
  const umbralAlerta = restaurante?.umbralAlertaCola ?? 10;
  const minutosReferencia = restaurante?.minutosPreparacionEstimados ?? 15;
  const limite = restaurante?.limitePedidosEnPreparacion ?? null;

  if (limite === null) {
    return {
      activa: false,
      limite: null,
      enPreparacion: 0,
      enEspera: 0,
      umbralAlerta,
      altaDemanda: false,
      minutosEstimados: minutosReferencia,
      orden: [],
    };
  }

  const enPreparacion = await contarEnPreparacion(tx, tenantId);
  const enEspera = await tx.pedido.findMany({
    where: { tenantId, estado: PedidoEstado.RECIBIDO },
    orderBy: ORDEN_COLA,
    select: { id: true },
  });

  return {
    activa: true,
    limite,
    enPreparacion,
    enEspera: enEspera.length,
    umbralAlerta,
    altaDemanda: enEspera.length > umbralAlerta,
    minutosEstimados: calcularMinutosEstimados(
      enEspera.length + 1,
      limite,
      minutosReferencia,
    ),
    orden: enEspera.map((pedido, indice) => ({
      pedidoId: pedido.id,
      posicion: indice + 1,
      minutosEstimados: calcularMinutosEstimados(
        indice + 1,
        limite,
        minutosReferencia,
      ),
    })),
  };
}
