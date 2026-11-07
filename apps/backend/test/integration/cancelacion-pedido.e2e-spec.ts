import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadGatewayException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { CancelacionPedidoService } from '../../src/pagos/cancelacion/cancelacion-pedido.service';
import { MercadoPagoGateway } from '../../src/pagos/gateways/mercadopago.gateway';
import { conPagoFalso } from './support/pago-falso';

// HU-024 (BL-104): cancelación de un pedido pagado y devolución del pago.
//
// Base, RLS, transacción, historial, auditoría y stock reales. Mercado Pago
// es falso (reembolsarOrden) y el CFE está apagado (conPagoFalso): la nota de
// crédito se prueba en los unitarios y en el contrato TC-C-021.
//
// Usa una mesa propia (número 75 del tenant A). Al terminar queda LIBRE y el
// ítem del seed vuelve a no controlar stock.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 75;
const ACTOR_PRUEBA = 'script:test-bl-104';

const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;
const itConMozoYCocina =
  MOZO_USER && MOZO_PASS && COCINA_USER && COCINA_PASS ? it : it.skip;

async function getToken(username: string, password: string): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username,
        password,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo obtener token para ${username}: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

class MercadoPagoFalso {
  reembolsos: { orderId: string; tenantId: string; clave: string }[] = [];
  fallar = false;
  reembolsarOrden(orderId: string, tenantId: string, clave: string) {
    if (this.fallar) {
      return Promise.reject(new BadGatewayException('MP caído'));
    }
    this.reembolsos.push({ orderId, tenantId, clave });
    return Promise.resolve();
  }
}

describe('HU-024 (BL-104): cancelación de un pedido pagado', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let cancelacion: CancelacionPedidoService;
  let mesaId: string;
  const mercadoPago = new MercadoPagoFalso();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Pedido de $ 590 (2 unidades) pagado, en el estado y con el medio que se pida. */
  const pedidoPagado = (
    estado: 'RECIBIDO' | 'EN_PREPARACION' | 'LISTO_PARA_ENTREGAR',
    medioPago: 'MERCADOPAGO' | 'EFECTIVO',
  ) =>
    enTenant<{ pedidoId: string; pagoId: string }>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-104-${randomUUID()}`,
          estado,
          canal: 'QR',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-104',
              precioUnitarioSnapshot: new Prisma.Decimal('295'),
              cantidad: 2,
              subtotal: new Prisma.Decimal('590'),
            },
          },
          pagos: {
            create: {
              tenantId: TENANT_ID,
              idempotencyKey: `bl-104-pago-${randomUUID()}`,
              monto: new Prisma.Decimal('590'),
              medioPago,
              estado: 'APROBADO',
              pasarelaReferencia:
                medioPago === 'MERCADOPAGO'
                  ? `ORD-BL104-${randomUUID()}`
                  : null,
            },
          },
        },
        select: { id: true, pagos: { select: { id: true } } },
      });
      return { pedidoId: pedido.id, pagoId: pedido.pagos[0].id };
    });

  const leer = (pedidoId: string) =>
    enTenant<{
      pedido: { estado: string };
      pagos: {
        id: string;
        estado: string;
        historial: { origen: string; detalle: string | null }[];
      }[];
      historial: { estadoNuevo: string }[];
      auditoria: { valoresDespues: unknown; detalle: unknown }[];
    }>(async (tx) => ({
      pedido: await tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: { estado: true },
      }),
      pagos: await tx.pago.findMany({
        where: { pedidoId },
        select: {
          id: true,
          estado: true,
          historial: { select: { origen: true, detalle: true } },
        },
      }),
      historial: await tx.pedidoEstadoHistorial.findMany({
        where: { pedidoId },
        select: { estadoNuevo: true },
      }),
      auditoria: await tx.registroAuditoria.findMany({
        where: { accion: 'PEDIDO_CANCELADO', entidadId: pedidoId },
        select: { valoresDespues: true, detalle: true },
      }),
    }));

  const stockDelItem = () =>
    enTenant<{ stockActual: number }>((tx) =>
      tx.itemCarta.findUniqueOrThrow({
        where: { id: ITEM_ID },
        select: { stockActual: true },
      }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(MercadoPagoGateway)
      .useValue(mercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts (TC-I-182 manda el body por HTTP).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    tenantPrisma = await app.resolve(TenantPrismaService);
    cancelacion = await app.resolve(CancelacionPedidoService);

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
    mercadoPago.fallar = false;
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: { mesaId, estado: { notIn: ['ENTREGADO', 'CANCELADO'] } },
        data: { estado: 'CANCELADO' },
      }),
    );
  });

  afterAll(async () => {
    await enTenant(async (tx) => {
      await tx.itemCarta.update({
        where: { id: ITEM_ID },
        data: { controlaStock: false, stockActual: 0 },
      });
      await tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      });
    }).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-179] HU-024: cancelar un pedido recibido pagado con Mercado Pago lo reembolsa, deja el pedido CANCELADO y el pago REEMBOLSADO con su historial, repone el stock y lo audita; otro tenant no lo ve', async () => {
    await enTenant((tx) =>
      tx.itemCarta.update({
        where: { id: ITEM_ID },
        data: { controlaStock: true, stockActual: 8 },
      }),
    );
    const { pedidoId, pagoId } = await pedidoPagado('RECIBIDO', 'MERCADOPAGO');

    await expect(
      cancelacion.cancelar(TENANT_B, ACTOR_PRUEBA, pedidoId, {
        motivo: 'ERROR_PEDIDO',
      }),
    ).rejects.toMatchObject({ status: 404 });

    const resultado = await cancelacion.cancelar(
      TENANT_ID,
      ACTOR_PRUEBA,
      pedidoId,
      { motivo: 'RECLAMO_CLIENTE', detalle: 'Llegó frío' },
    );

    expect(resultado).toMatchObject({
      estado: 'CANCELADO',
      monto: '590.00',
      stockRepuesto: true,
    });
    expect(mercadoPago.reembolsos.at(-1)).toMatchObject({
      tenantId: TENANT_ID,
      clave: `reembolso-${pagoId}`,
    });
    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('CANCELADO');
    expect(estado.historial).toEqual([{ estadoNuevo: 'CANCELADO' }]);
    expect(estado.pagos[0]).toMatchObject({
      estado: 'REEMBOLSADO',
      historial: [{ origen: 'CANCELACION', detalle: 'REEMBOLSO_MERCADOPAGO' }],
    });
    expect(estado.auditoria).toEqual([
      {
        valoresDespues: {
          motivo: 'Reclamo del cliente',
          monto: '590.00',
          devolucion: 'Mercado Pago (reembolso automático)',
          stockRepuesto: true,
        },
        detalle: {
          motivo: 'RECLAMO_CLIENTE',
          detalle: 'Llegó frío',
          estadoAnterior: 'RECIBIDO',
          pagos: [pagoId],
        },
      },
    ]);
    // Se descontaron 2 al confirmarse el pago (8 = 10 - 2): vuelven.
    expect((await stockDelItem()).stockActual).toBe(10);
  });

  it('[TC-I-180] HU-024: si Mercado Pago no reembolsa, el pedido no se cancela (502) y el pago sigue APROBADO; un pedido listo para entregar no se puede cancelar (409)', async () => {
    const { pedidoId } = await pedidoPagado('EN_PREPARACION', 'MERCADOPAGO');
    mercadoPago.fallar = true;

    await expect(
      cancelacion.cancelar(TENANT_ID, ACTOR_PRUEBA, pedidoId, {
        motivo: 'ERROR_PEDIDO',
      }),
    ).rejects.toMatchObject({ status: 502 });
    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('EN_PREPARACION');
    expect(estado.pagos[0].estado).toBe('APROBADO');
    expect(estado.auditoria).toHaveLength(0);

    const listo = await pedidoPagado('LISTO_PARA_ENTREGAR', 'MERCADOPAGO');
    mercadoPago.fallar = false;
    await expect(
      cancelacion.cancelar(TENANT_ID, ACTOR_PRUEBA, listo.pedidoId, {
        motivo: 'ERROR_PEDIDO',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('[TC-I-181] HU-024: un pedido en preparación pagado en efectivo pide confirmar la devolución manual; confirmada, queda CANCELADO y el pago REEMBOLSADO sin pasar por Mercado Pago ni reponer el stock', async () => {
    await enTenant((tx) =>
      tx.itemCarta.update({
        where: { id: ITEM_ID },
        data: { controlaStock: true, stockActual: 5 },
      }),
    );
    const { pedidoId } = await pedidoPagado('EN_PREPARACION', 'EFECTIVO');
    const reembolsosAntes = mercadoPago.reembolsos.length;

    await expect(
      cancelacion.cancelar(TENANT_ID, ACTOR_PRUEBA, pedidoId, {
        motivo: 'PRODUCTO_NO_DISPONIBLE',
      }),
    ).rejects.toMatchObject({ status: 400 });

    const resultado = await cancelacion.cancelar(
      TENANT_ID,
      ACTOR_PRUEBA,
      pedidoId,
      { motivo: 'PRODUCTO_NO_DISPONIBLE', devolucionManualConfirmada: true },
    );

    expect(resultado.stockRepuesto).toBe(false);
    expect(mercadoPago.reembolsos).toHaveLength(reembolsosAntes);
    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('CANCELADO');
    expect(estado.pagos[0]).toMatchObject({
      estado: 'REEMBOLSADO',
      historial: [{ origen: 'CANCELACION', detalle: 'DEVOLUCION_MANUAL' }],
    });
    expect((await stockDelItem()).stockActual).toBe(5);
  });

  itConMozoYCocina(
    '[TC-I-182] HU-024: el mozo ve la vista previa y cancela por HTTP; Cocina recibe 403 y un motivo «Otro» sin detalle da 400',
    async () => {
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const { pedidoId } = await pedidoPagado('RECIBIDO', 'MERCADOPAGO');
      const servidor = app.getHttpServer();
      const ruta = `/pedidos/${pedidoId}/cancelacion`;

      const vista = await request(servidor)
        .get(ruta)
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(200);
      expect(vista.body).toMatchObject({
        monto: '590.00',
        motivoNoCancelable: null,
        devoluciones: [{ medio: 'MERCADOPAGO', automatica: true }],
      });

      await request(servidor)
        .post(ruta)
        .set('Authorization', `Bearer ${tokenCocina}`)
        .send({ motivo: 'ERROR_PEDIDO' })
        .expect(403);

      await request(servidor)
        .post(ruta)
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({ motivo: 'OTRO' })
        .expect(400);

      const cancelado = await request(servidor)
        .post(ruta)
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({ motivo: 'COBRO_DUPLICADO' })
        .expect(201);
      expect(cancelado.body.estado).toBe('CANCELADO');
      expect((await leer(pedidoId)).pedido.estado).toBe('CANCELADO');
    },
  );
});
