import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MercadoPagoGateway } from '../../src/pagos/gateways/mercadopago.gateway';
import { armarReferenciaExterna } from '../../src/pagos/webhooks/referencia-externa';
import { PagosWebhookService } from '../../src/pagos/webhooks/pagos-webhook.service';
import { ConciliacionPagosService } from '../../src/pagos/conciliacion/conciliacion-pagos.service';
import { conPagoFalso } from './support/pago-falso';

// HU-032 (BL-202): vencimiento y conciliación de pagos pendientes.
//
// No se conecta a Mercado Pago: la consulta de la order (consultarOrden) es
// falsa y cada test decide qué responde. El resto es real: base, RLS,
// transacciones, PedidosService y el flujo del webhook.
//
// Usa una mesa propia (número 96 del tenant A) para no tocar las del seed.
// Al terminar queda LIBRE.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 96;
const MINUTO = 60_000;
const PARAMETROS = {
  conciliarDespuesMs: 2 * MINUTO,
  vencerDespuesMs: 15 * MINUTO,
  lote: 50,
};

/** Respuesta de la order falsa de Mercado Pago, por id de order. */
const ordenes = new Map<
  string,
  { status: string; statusDetail: string; pedidoId: string; monto: string }
>();

const mercadoPagoFalso = {
  consultarOrden: (orderId: string) => {
    const orden = ordenes.get(orderId);
    return Promise.resolve(
      orden
        ? {
            id: orderId,
            status: orden.status,
            statusDetail: orden.statusDetail,
            totalAmount: orden.monto,
            externalReference: armarReferenciaExterna(
              TENANT_ID,
              orden.pedidoId,
            ),
          }
        : null,
    );
  },
};

describe('HU-032 (BL-202): vencimiento y conciliación de pagos pendientes', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let conciliacion: ConciliacionPagosService;
  let webhook: PagosWebhookService;
  let mesaId: string;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
    tenantId = TENANT_ID,
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  /**
   * Un pedido en PENDIENTE_PAGO con un pago PENDIENTE de hace `minutos`, y la
   * mesa cobrando (EN_PROCESO_DE_PAGO), como queda cuando el webhook no llega.
   */
  async function pagoPendiente(
    minutos: number,
    orden?: { status: string; statusDetail: string },
  ) {
    const orderId = orden ? `ORD-BL202-${randomUUID()}` : null;
    const ids = await enTenant<{ pedidoId: string; pagoId: string }>(
      async (tx) => {
        const pedido = await tx.pedido.create({
          data: {
            tenantId: TENANT_ID,
            restauranteId: RESTAURANTE_ID,
            mesaId,
            idempotencyKey: `bl-202-${randomUUID()}`,
            estado: 'PENDIENTE_PAGO',
            canal: 'QR',
            lineas: {
              create: {
                tenantId: TENANT_ID,
                itemCartaId: ITEM_ID,
                nombreSnapshot: 'Item de prueba BL-202',
                precioUnitarioSnapshot: new Prisma.Decimal('590'),
                cantidad: 1,
                subtotal: new Prisma.Decimal('590'),
              },
            },
          },
          select: { id: true },
        });
        const pago = await tx.pago.create({
          data: {
            tenantId: TENANT_ID,
            pedidoId: pedido.id,
            idempotencyKey: `bl-202-${randomUUID()}`,
            monto: new Prisma.Decimal('590'),
            medioPago: 'MERCADOPAGO',
            estado: 'PENDIENTE',
            pasarelaReferencia: orderId,
            createdAt: new Date(Date.now() - minutos * MINUTO),
          },
          select: { id: true },
        });
        await tx.mesa.update({
          where: { id: mesaId },
          data: { estado: 'EN_PROCESO_DE_PAGO' },
        });
        return { pedidoId: pedido.id, pagoId: pago.id };
      },
    );
    if (orderId && orden) {
      ordenes.set(orderId, { ...orden, pedidoId: ids.pedidoId, monto: '590' });
    }
    return { ...ids, orderId };
  }

  const leer = (pedidoId: string, pagoId: string) =>
    enTenant<{
      pago: { estado: string; motivoRechazo: string | null };
      pedido: { estado: string };
      mesa: { estado: string };
      historial: {
        estadoNuevo: string;
        origen: string;
        detalle: string | null;
      }[];
      historialPedido: number;
    }>(async (tx) => ({
      pago: await tx.pago.findUniqueOrThrow({
        where: { id: pagoId },
        select: { estado: true, motivoRechazo: true },
      }),
      pedido: await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: { estado: true },
      }),
      mesa: await tx.mesa.findUniqueOrThrow({
        where: { id: mesaId },
        select: { estado: true },
      }),
      historial: await tx.pagoEstadoHistorial.findMany({
        where: { pagoId },
        orderBy: { createdAt: 'asc' },
        select: { estadoNuevo: true, origen: true, detalle: true },
      }),
      historialPedido: await tx.pedidoEstadoHistorial.count({
        where: { pedidoId, estadoNuevo: 'RECIBIDO' },
      }),
    }));

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(MercadoPagoGateway)
      .useValue(mercadoPagoFalso)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tenantPrisma = await app.resolve(TenantPrismaService);
    conciliacion = await app.resolve(ConciliacionPagosService);
    webhook = await app.resolve(PagosWebhookService);

    // Mesa propia del test, ocupada (con sesión, HU-017) y sin pagos en
    // curso de corridas anteriores.
    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero: NUMERO_MESA_TEST },
        select: { id: true },
      });
      const datos = {
        estado: 'OCUPADA' as const,
        sesionId: randomUUID(),
        sesionAbiertaEn: new Date(),
      };
      if (existente) {
        await tx.pago.updateMany({
          where: { estado: 'PENDIENTE', pedido: { mesaId: existente.id } },
          data: { estado: 'RECHAZADO' },
        });
        return tx.mesa.update({
          where: { id: existente.id },
          data: datos,
          select: { id: true },
        });
      }
      return tx.mesa.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          numero: NUMERO_MESA_TEST,
          ...datos,
        },
        select: { id: true },
      });
    });
    mesaId = mesa.id;
  }, 30000);

  afterEach(async () => {
    // Cada test arranca con la mesa ocupada y sin cobros en curso.
    await enTenant(async (tx) => {
      await tx.pago.updateMany({
        where: { estado: 'PENDIENTE', pedido: { mesaId } },
        data: { estado: 'RECHAZADO' },
      });
      await tx.pedido.updateMany({
        where: { mesaId, estado: { notIn: ['ENTREGADO', 'CANCELADO'] } },
        data: { estado: 'CANCELADO' },
      });
      await tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'OCUPADA' },
      });
    });
  });

  afterAll(async () => {
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-095] HU-032: pago pendiente sin webhook vence a los 15 minutos; el pedido no entra a cocina', async () => {
    const { pedidoId, pagoId } = await pagoPendiente(16, {
      status: 'processing',
      statusDetail: 'in_process',
    });

    const resumen = await conciliacion.conciliarTenant(TENANT_ID, PARAMETROS);

    expect(resumen.vencidos).toBeGreaterThanOrEqual(1);
    const estado = await leer(pedidoId, pagoId);
    expect(estado.pago).toEqual({
      estado: 'RECHAZADO',
      motivoRechazo: 'VENCIDO',
    });
    expect(estado.pedido.estado).toBe('PENDIENTE_PAGO');
    expect(estado.historialPedido).toBe(0);
    expect(estado.mesa.estado).toBe('OCUPADA');
    expect(estado.historial).toEqual([
      { estadoNuevo: 'RECHAZADO', origen: 'VENCIMIENTO', detalle: 'VENCIDO' },
    ]);
  });

  it('[TC-I-096] HU-032: webhook perdido y la pasarela lo aprobó: la conciliación lo pasa a RECIBIDO una sola vez', async () => {
    const { pedidoId, pagoId } = await pagoPendiente(5, {
      status: 'processed',
      statusDetail: 'accredited',
    });

    await conciliacion.conciliarTenant(TENANT_ID, PARAMETROS);
    // Una segunda corrida (o el webhook que llega tarde) no cambia nada.
    await conciliacion.conciliarTenant(TENANT_ID, PARAMETROS);
    expect(
      await webhook.procesarOrden(
        (
          await enTenant<{ pasarelaReferencia: string }>((tx) =>
            tx.pago.findUniqueOrThrow({
              where: { id: pagoId },
              select: { pasarelaReferencia: true },
            }),
          )
        ).pasarelaReferencia,
      ),
    ).toBe('sin_cambios');

    const estado = await leer(pedidoId, pagoId);
    expect(estado.pago.estado).toBe('APROBADO');
    expect(estado.pedido.estado).toBe('RECIBIDO');
    expect(estado.historialPedido).toBe(1);
    expect(estado.mesa.estado).toBe('OCUPADA');
    expect(estado.historial).toEqual([
      { estadoNuevo: 'APROBADO', origen: 'CONCILIACION', detalle: null },
    ]);
  });

  it('[TC-I-097] HU-032: webhook tardío sobre un pago vencido con el pedido ya pagado: queda para reembolso', async () => {
    const vencido = await pagoPendiente(20, {
      status: 'processing',
      statusDetail: 'in_process',
    });
    await conciliacion.conciliarTenant(TENANT_ID, PARAMETROS);

    // El comensal pagó de nuevo y ese pago se aprobó.
    await enTenant(async (tx) => {
      await tx.pago.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId: vencido.pedidoId,
          idempotencyKey: `bl-202-${randomUUID()}`,
          monto: new Prisma.Decimal('590'),
          medioPago: 'MERCADOPAGO',
          estado: 'APROBADO',
          pasarelaReferencia: `ORD-BL202-${randomUUID()}`,
        },
      });
      await tx.pedido.update({
        where: { id: vencido.pedidoId },
        data: { estado: 'RECIBIDO' },
      });
    });

    // Recién ahora Mercado Pago aprueba la order del pago vencido.
    ordenes.set(vencido.orderId!, {
      status: 'processed',
      statusDetail: 'accredited',
      pedidoId: vencido.pedidoId,
      monto: '590',
    });
    expect(await webhook.procesarOrden(vencido.orderId!)).toBe(
      'requiere_reembolso',
    );

    const estado = await leer(vencido.pedidoId, vencido.pagoId);
    expect(estado.pago.estado).toBe('APROBADO');
    expect(estado.historial.map((h) => h.detalle)).toEqual([
      'VENCIDO',
      'REQUIERE_REEMBOLSO',
    ]);
    expect(estado.historial[1].origen).toBe('WEBHOOK');
    // El pedido no se confirmó dos veces.
    expect(estado.historialPedido).toBe(0);
  });

  it('[TC-I-098] HU-032: el historial de pagos tiene RLS y no se puede modificar ni borrar', async () => {
    const { pagoId } = await pagoPendiente(16);
    await conciliacion.conciliarTenant(TENANT_ID, PARAMETROS);

    // Desde otro tenant no se ve.
    const ajeno = await enTenant<number>(
      (tx) => tx.pagoEstadoHistorial.count({ where: { pagoId } }),
      randomUUID(),
    );
    expect(ajeno).toBe(0);

    // Sin políticas de UPDATE ni DELETE: no afectan ninguna fila.
    const cambios = await enTenant<{ update: number; borrado: number }>(
      async (tx) => ({
        update: (
          await tx.pagoEstadoHistorial.updateMany({
            where: { pagoId },
            data: { detalle: 'ALTERADO' },
          })
        ).count,
        borrado: (
          await tx.pagoEstadoHistorial.deleteMany({ where: { pagoId } })
        ).count,
      }),
    );
    expect(cambios).toEqual({ update: 0, borrado: 0 });
    const propio = await enTenant<number>((tx) =>
      tx.pagoEstadoHistorial.count({ where: { pagoId, detalle: 'VENCIDO' } }),
    );
    expect(propio).toBe(1);
  });
});
