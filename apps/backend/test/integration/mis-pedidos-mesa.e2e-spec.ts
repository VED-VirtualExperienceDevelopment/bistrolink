import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MENSAJE_PEDIDO_DE_OTRA_SESION } from '../../src/pedidos/pedido-acceso.guard';
import { asegurarClaveQr, tokenQrDeMesa } from './support/qr-mesa';
import { conPagoFalso } from './support/pago-falso';

// BL-502: «Mis pedidos» del comensal en la mesa (POST /pedidos/mesa/estado)
// y acceso a un pedido de mesa solo en la sesión abierta (RD.05).
//
// Con Keycloak, base, RLS y guards reales; falsos solo la pasarela y el CFE. Las
// mesas 72 y 73 son de este test: se abren con una sesión propia y quedan
// libres al terminar. BL-518: antes eran la 82 y la 83, pero del 80 al 99
// son de mesas-layout.e2e-spec.ts, que borra esas mesas en cada corrida.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const MESA_NUMERO = 72;
const OTRA_MESA_NUMERO = 73;
const NOMBRE_ITEM = 'Item de prueba BL-502';

describe('BL-502: Mis pedidos en la mesa', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let mesaId: string;
  let otraMesaId: string;
  let qrToken: string;
  let otroQrToken: string;
  let sesion: string;
  let otraSesion: string;
  const pedidosCreados: string[] = [];

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const http = () => request(app.getHttpServer());

  /** Deja la mesa ocupada con una sesión nueva, abierta ahora. */
  const abrirMesa = async (numero: number) => {
    const sesionId = randomUUID();
    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero },
        select: { id: true },
      });
      const datos = {
        estado: 'OCUPADA' as const,
        sesionId,
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
          numero,
          ...datos,
        },
        select: { id: true },
      });
    });
    return { mesaId: mesa.id, sesionId };
  };

  const tokenComensal = async (qr: string, sesionMesa: string) => {
    const res = await http()
      .post('/auth/comensal/mesa')
      .send({ qrToken: qr, sesionMesa })
      .expect(200);
    return res.body.accessToken as string;
  };

  /** Pedido de mesa creado directo en la base (estado y fecha a elección). */
  const crearPedido = async (
    enMesa: string,
    estado: string,
    extra: { createdAt?: Date; propinaMonto?: number; canal?: 'QR' } = {},
  ) => {
    const { id } = await enTenant<{ id: string }>((tx) =>
      tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: enMesa,
          idempotencyKey: `bl-502-${randomUUID()}`,
          estado: estado as never,
          canal: extra.canal ?? 'QR',
          propinaMonto: extra.propinaMonto,
          ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: NOMBRE_ITEM,
              precioUnitarioSnapshot: new Prisma.Decimal('295'),
              cantidad: 2,
              subtotal: new Prisma.Decimal('590'),
            },
          },
        },
        select: { id: true },
      }),
    );
    pedidosCreados.push(id);
    return id;
  };

  const consultar = (
    token: string,
    ids: unknown,
    headers: Record<string, string> = {
      'X-Mesa-Token': qrToken,
      'X-Mesa-Sesion': sesion,
    },
  ) =>
    http()
      .post('/pedidos/mesa/estado')
      .set('Authorization', `Bearer ${token}`)
      .set(headers)
      .send({ ids });

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts (TC-I-204 valida los ids del body).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);

    ({ mesaId, sesionId: sesion } = await abrirMesa(MESA_NUMERO));
    ({ mesaId: otraMesaId, sesionId: otraSesion } =
      await abrirMesa(OTRA_MESA_NUMERO));
    qrToken = await tokenQrDeMesa(app, TENANT_ID, mesaId);
    otroQrToken = await tokenQrDeMesa(app, TENANT_ID, otraMesaId);
  }, 30000);

  afterAll(async () => {
    await enTenant(async (tx) => {
      await tx.pedido.updateMany({
        where: {
          id: { in: pedidosCreados },
          estado: { notIn: ['ENTREGADO', 'CANCELADO'] },
        },
        data: { estado: 'CANCELADO' },
      });
      await tx.mesa.updateMany({
        where: { id: { in: [mesaId, otraMesaId] } },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      });
    }).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-203] Mis pedidos: devuelve solo los pedidos de esta mesa y de la sesión abierta, con estado, ítems y totales, sin datos de pago', async () => {
    const token = await tokenComensal(qrToken, sesion);
    const actual = await crearPedido(mesaId, 'EN_PREPARACION', {
      propinaMonto: 59,
    });
    const entregado = await crearPedido(mesaId, 'ENTREGADO');
    // De un grupo anterior en la misma mesa (antes de abrirse la sesión,
    // más allá del margen de relojes).
    const deSesionAnterior = await crearPedido(mesaId, 'ENTREGADO', {
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const deOtraMesa = await crearPedido(otraMesaId, 'RECIBIDO');

    const res = await consultar(token, [
      actual,
      entregado,
      deSesionAnterior,
      deOtraMesa,
      randomUUID(),
    ]).expect(200);

    expect(res.body.map((p: { id: string }) => p.id).sort()).toEqual(
      [actual, entregado].sort(),
    );
    const enPreparacion = res.body.find((p: { id: string }) => p.id === actual);
    expect(enPreparacion).toEqual({
      id: actual,
      estado: 'EN_PREPARACION',
      creadoEn: expect.any(String),
      actualizadoEn: expect.any(String),
      lineas: [{ nombre: NOMBRE_ITEM, cantidad: 2 }],
      consumo: '590.00',
      propina: 59,
    });

    // Sin ids, nada.
    await consultar(token, []).expect(200, []);
  });

  it('[TC-I-204] Mis pedidos: sin el QR de la mesa responde 400, con la sesión vieja 410 SESION_VENCIDA, con el QR de otra mesa no ve estos pedidos, y valida la lista de ids', async () => {
    const token = await tokenComensal(qrToken, sesion);
    const pedido = await crearPedido(mesaId, 'RECIBIDO');

    await consultar(token, [pedido], {}).expect(400);

    const vencida = await consultar(token, [pedido], {
      'X-Mesa-Token': qrToken,
      'X-Mesa-Sesion': randomUUID(),
    }).expect(410);
    expect(vencida.body.codigo).toBe('SESION_VENCIDA');

    const desdeOtraMesa = await consultar(
      await tokenComensal(otroQrToken, otraSesion),
      [pedido],
      { 'X-Mesa-Token': otroQrToken, 'X-Mesa-Sesion': otraSesion },
    ).expect(200);
    expect(desdeOtraMesa.body).toEqual([]);

    await consultar(token, ['no-es-uuid']).expect(400);
    await consultar(token, [pedido, pedido]).expect(400);
    await consultar(token, 'x').expect(400);
    await consultar(
      token,
      Array.from({ length: 31 }, () => randomUUID()),
    ).expect(400);
  });

  it('[TC-I-205] RD.05: el pago y el comprobante de un pedido de la sesión anterior de la mesa responden 403; los de la sesión abierta, no', async () => {
    const token = await tokenComensal(qrToken, sesion);
    const actual = await crearPedido(mesaId, 'PENDIENTE_PAGO');
    const anterior = await crearPedido(mesaId, 'ENTREGADO', {
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const pagos = (pedidoId: string) =>
      http()
        .get(`/pedidos/${pedidoId}/pagos`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Mesa-Token', qrToken)
        .set('X-Mesa-Sesion', sesion);

    await pagos(actual).expect(200);

    const prohibido = await pagos(anterior).expect(403);
    expect(prohibido.body.message).toBe(MENSAJE_PEDIDO_DE_OTRA_SESION);

    await http()
      .get(`/pedidos/${anterior}/pagos/comprobante/pdf`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Mesa-Token', qrToken)
      .set('X-Mesa-Sesion', sesion)
      .expect(403);
  });
});
