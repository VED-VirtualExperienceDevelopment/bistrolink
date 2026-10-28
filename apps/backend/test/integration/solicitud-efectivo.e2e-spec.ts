import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { SolicitudEfectivoService } from '../../src/pagos/efectivo/solicitud-efectivo.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { conPagoFalso } from './support/pago-falso';
import {
  asegurarClaveQr,
  sesionDeMesa,
  tokenQrDeMesa,
} from './support/qr-mesa';

// HU-031b (BL-442): el comensal de una mesa elige pagar en efectivo y se
// avisa al mozo.
//
// Todo es real (base, RLS, guards, aviso por el gateway) salvo la pasarela
// y el CFE (conPagoFalso). Usa una mesa propia (número 93 del tenant A), que
// al terminar queda LIBRE. El test por HTTP necesita el token del comensal
// (POST /auth/comensal/mesa, con Keycloak), igual que los demás tests del QR.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_DEMO_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 93;

describe('HU-031b (BL-442): solicitud de pago en efectivo', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tenantPrisma: TenantPrismaService;
  let solicitudes: SolicitudEfectivoService;
  let cobros: CobroEfectivoService;
  let gateway: KdsGateway;
  let mesaId: string;
  let sesionMesa: string;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Un pedido esperando el pago, de $ 590, en la mesa de prueba o para retirar. */
  const pedidoPendiente = (canal: 'QR' | 'WEB' = 'QR') =>
    enTenant<string>(async (tx) => {
      const mesa =
        canal === 'QR'
          ? { id: mesaId }
          : await tx.mesa.findFirstOrThrow({
              where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
              select: { id: true },
            });
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: mesa.id,
          idempotencyKey: `bl-442-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal,
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-442',
              precioUnitarioSnapshot: new Prisma.Decimal('590'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('590'),
            },
          },
        },
        select: { id: true },
      });
      return pedido.id;
    });

  const leerSolicitud = (pedidoId: string) =>
    enTenant<{
      efectivoSolicitadoEn: Date | null;
      efectivoPagaCon: Prisma.Decimal | null;
      estado: string;
    }>((tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          efectivoSolicitadoEn: true,
          efectivoPagaCon: true,
          estado: true,
        },
      }),
    );

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://localhost:${port}`;

    tenantPrisma = await app.resolve(TenantPrismaService);
    solicitudes = await app.resolve(SolicitudEfectivoService);
    cobros = await app.resolve(CobroEfectivoService);
    gateway = app.get(KdsGateway);

    // Mesa propia del test, ocupada (con sesión, HU-017).
    sesionMesa = randomUUID();
    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero: NUMERO_MESA_TEST },
        select: { id: true },
      });
      const datos = {
        estado: 'OCUPADA' as const,
        sesionId: sesionMesa,
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
    jest.restoreAllMocks();
    // Ningún pedido de prueba queda esperando el pago.
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: {
          estado: 'PENDIENTE_PAGO',
          lineas: { some: { nombreSnapshot: 'Item de prueba BL-442' } },
        },
        data: { estado: 'CANCELADO' },
      }),
    );
  });

  afterAll(async () => {
    await enTenant(async (tx) => {
      await tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { efectivoHabilitado: true },
      });
      await tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      });
    }).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-118] HU-031b: la solicitud de efectivo de un pedido de mesa queda guardada, avisa al staff y aparece primera en cobros pendientes', async () => {
    const aviso = jest.spyOn(gateway, 'emitirLlamado');
    const otro = await pedidoPendiente();
    const pedidoId = await pedidoPendiente();

    const solicitud = await solicitudes.solicitar(TENANT_ID, pedidoId, {
      pagaCon: '1000',
    });

    expect(solicitud).toMatchObject({
      total: '590.00',
      pagaCon: '1000.00',
      avisado: true,
    });
    const guardado = await leerSolicitud(pedidoId);
    expect(guardado.estado).toBe('PENDIENTE_PAGO');
    expect(guardado.efectivoSolicitadoEn).toBeInstanceOf(Date);
    expect(guardado.efectivoPagaCon?.toFixed(2)).toBe('1000.00');
    expect(aviso).toHaveBeenCalledWith(TENANT_ID, mesaId, NUMERO_MESA_TEST, {
      pedidoId,
      total: '590.00',
      pagaCon: '1000.00',
    });

    // No crea un pago: el pedido sigue esperando el cobro del mozo.
    const pagos = await enTenant<number>((tx) =>
      tx.pago.count({ where: { pedidoId } }),
    );
    expect(pagos).toBe(0);

    const { pedidos } = await cobros.pendientes(TENANT_ID);
    const ids = pedidos.map((p) => p.id);
    expect(ids.indexOf(pedidoId)).toBeLessThan(ids.indexOf(otro));
    expect(
      pedidos.find((p) => p.id === pedidoId)?.efectivoSolicitado,
    ).toMatchObject({
      pagaCon: '1000.00',
    });
  });

  it('[TC-I-119] HU-031b: un pedido para retirar (fuera del local) no puede pedir efectivo: 409 y no se guarda nada', async () => {
    const aviso = jest.spyOn(gateway, 'emitirLlamado');
    const pedidoId = await pedidoPendiente('WEB');

    await expect(
      solicitudes.solicitar(TENANT_ID, pedidoId, {}),
    ).rejects.toThrow(ConflictException);

    const guardado = await leerSolicitud(pedidoId);
    expect(guardado.efectivoSolicitadoEn).toBeNull();
    expect(aviso).not.toHaveBeenCalled();
  });

  it('[TC-I-120] HU-031b: con el efectivo deshabilitado en el establecimiento, la solicitud se rechaza', async () => {
    const pedidoId = await pedidoPendiente();
    await enTenant((tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { efectivoHabilitado: false },
      }),
    );

    try {
      await expect(
        solicitudes.solicitar(TENANT_ID, pedidoId, {}),
      ).rejects.toThrow('Este local no acepta pagos en efectivo');
    } finally {
      await enTenant((tx) =>
        tx.restaurante.update({
          where: { id: RESTAURANTE_ID },
          data: { efectivoHabilitado: true },
        }),
      );
    }

    expect((await leerSolicitud(pedidoId)).efectivoSolicitadoEn).toBeNull();
  });

  it('[TC-I-121] HU-031b: por HTTP solo la pide el comensal con el QR y la sesión de su mesa; GET de pagos dice que está disponible y ya avisado', async () => {
    const pedidoId = await pedidoPendiente();
    const qrToken = await tokenQrDeMesa(app, TENANT_ID, mesaId);
    const authRes = await fetch(`${baseUrl}/auth/comensal/mesa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrToken, sesionMesa }),
    });
    expect(authRes.ok).toBe(true);
    const tokenComensal = (await authRes.json()).accessToken as string;
    const ruta = `${baseUrl}/pedidos/${pedidoId}/pagos`;
    const conMesa = (qr: string, sesion: string) => ({
      Authorization: `Bearer ${tokenComensal}`,
      'Content-Type': 'application/json',
      'X-Mesa-Token': qr,
      'X-Mesa-Sesion': sesion,
    });

    // Sin el QR de la mesa: 400.
    const sinQr = await fetch(`${ruta}/solicitud-efectivo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenComensal}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(sinQr.status).toBe(400);

    // Con el QR de OTRA mesa: 403.
    const qrOtra = await tokenQrDeMesa(app, TENANT_ID, MESA_DEMO_ID);
    const sesionOtra = await sesionDeMesa(app, TENANT_ID, MESA_DEMO_ID);
    const otraMesa = await fetch(`${ruta}/solicitud-efectivo`, {
      method: 'POST',
      headers: conMesa(qrOtra, sesionOtra),
      body: '{}',
    });
    expect(otraMesa.status).toBe(403);

    // Con el QR y la sesión de su mesa: 200.
    const ok = await fetch(`${ruta}/solicitud-efectivo`, {
      method: 'POST',
      headers: conMesa(qrToken, sesionMesa),
      body: JSON.stringify({ pagaCon: '600' }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ pagaCon: '600.00', avisado: true });

    const estado = await fetch(ruta, { headers: conMesa(qrToken, sesionMesa) });
    expect(estado.status).toBe(200);
    expect((await estado.json()).efectivo).toMatchObject({
      disponible: true,
      pagaCon: '600.00',
    });
  });
});
