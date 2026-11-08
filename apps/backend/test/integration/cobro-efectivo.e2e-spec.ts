import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { conPagoFalso } from './support/pago-falso';

// HU-031 (BL-201): registro de cobro en efectivo.
//
// El CFE está apagado (conPagoFalso): no se llama a Surtec. Todo lo demás es
// real: base, RLS, transacción, historial y auditoría.
//
// Usa una mesa propia (número 94 del tenant A) para no tocar las del seed.
// Al terminar queda LIBRE. La carta todavía no maneja stock (HU-005): el
// descuento de stock del DoD queda para cuando exista.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 94;
const ACTOR_PRUEBA = 'script:test-bl-201';

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

describe('HU-031 (BL-201): cobro en efectivo', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let cobros: CobroEfectivoService;
  let mesaId: string;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Un pedido de la mesa de prueba esperando el pago, de $ 590. */
  const pedidoPendiente = () =>
    enTenant<string>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-201-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'QR',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-201',
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

  const leer = (pedidoId: string) =>
    enTenant<{
      pedido: { estado: string };
      pagos: { medioPago: string; estado: string; monto: Prisma.Decimal }[];
      historial: { estadoNuevo: string }[];
      auditoria: {
        valoresDespues: unknown;
        detalle: unknown;
        actorKeycloakId: string;
      }[];
    }>(async (tx) => {
      const pagos = await tx.pago.findMany({
        where: { pedidoId },
        select: { id: true, medioPago: true, estado: true, monto: true },
      });
      return {
        pedido: await tx.pedido.findUniqueOrThrow({
          where: { id: pedidoId },
          select: { estado: true },
        }),
        pagos,
        historial: await tx.pedidoEstadoHistorial.findMany({
          where: { pedidoId },
          select: { estadoNuevo: true },
        }),
        auditoria: await tx.registroAuditoria.findMany({
          where: {
            accion: 'PAGO_EFECTIVO_REGISTRADO',
            entidadId: { in: pagos.map((p) => p.id) },
          },
          select: {
            valoresDespues: true,
            detalle: true,
            actorKeycloakId: true,
          },
        }),
      };
    });

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    tenantPrisma = await app.resolve(TenantPrismaService);
    cobros = await app.resolve(CobroEfectivoService);

    // Mesa propia del test, ocupada (con sesión, HU-017).
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
    // Ningún pedido de la mesa queda en cocina ni esperando el pago.
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: { mesaId, estado: { notIn: ['ENTREGADO', 'CANCELADO'] } },
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

  it('[TC-I-113] HU-031: el cobro en efectivo deja el pedido en RECIBIDO, el pago EFECTIVO/APROBADO y la auditoría con el vuelto', async () => {
    const pedidoId = await pedidoPendiente();

    const cobro = await cobros.registrar(TENANT_ID, ACTOR_PRUEBA, {
      pedidoId,
      idempotencyKey: `bl-201-${randomUUID()}`,
      montoRecibido: '1000',
    });

    expect(cobro).toMatchObject({
      pedidoId,
      monto: '590.00',
      montoRecibido: '1000.00',
      vuelto: '410.00',
    });
    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('RECIBIDO');
    expect(estado.pagos).toHaveLength(1);
    expect(estado.pagos[0]).toMatchObject({
      medioPago: 'EFECTIVO',
      estado: 'APROBADO',
    });
    expect(estado.pagos[0].monto.toFixed(2)).toBe('590.00');
    expect(estado.historial).toEqual([{ estadoNuevo: 'RECIBIDO' }]);
    expect(estado.auditoria).toEqual([
      {
        actorKeycloakId: ACTOR_PRUEBA,
        valoresDespues: {
          monto: '590.00',
          montoRecibido: '1000.00',
          vuelto: '410.00',
        },
        detalle: { pedidoId },
      },
    ]);
  });

  it('[TC-I-114] HU-031: el mismo idempotency key dos veces registra un único cobro', async () => {
    const pedidoId = await pedidoPendiente();
    const solicitud = {
      pedidoId,
      idempotencyKey: `bl-201-${randomUUID()}`,
      montoRecibido: '600',
    };

    const primero = await cobros.registrar(TENANT_ID, ACTOR_PRUEBA, solicitud);
    const segundo = await cobros.registrar(TENANT_ID, ACTOR_PRUEBA, solicitud);

    expect(segundo).toEqual(primero);
    const estado = await leer(pedidoId);
    expect(estado.pagos).toHaveLength(1);
    expect(estado.historial).toHaveLength(1);
    expect(estado.auditoria).toHaveLength(1);
  });

  it('[TC-I-115] HU-031: dos cobros simultáneos del mismo pedido con claves distintas: queda uno solo', async () => {
    const pedidoId = await pedidoPendiente();
    const cobrar = () =>
      cobros.registrar(TENANT_ID, ACTOR_PRUEBA, {
        pedidoId,
        idempotencyKey: `bl-201-${randomUUID()}`,
        montoRecibido: '590',
      });

    const resultados = await Promise.allSettled([cobrar(), cobrar()]);

    const rechazados = resultados.filter((r) => r.status === 'rejected');
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rechazados).toHaveLength(1);
    expect((rechazados[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('RECIBIDO');
    expect(estado.pagos).toHaveLength(1);
  });

  it('[TC-I-116] HU-031: con el efectivo deshabilitado en el establecimiento, 409 y el pedido sigue esperando el pago', async () => {
    const pedidoId = await pedidoPendiente();
    await enTenant((tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { efectivoHabilitado: false },
      }),
    );

    try {
      await expect(
        cobros.registrar(TENANT_ID, ACTOR_PRUEBA, {
          pedidoId,
          idempotencyKey: `bl-201-${randomUUID()}`,
          montoRecibido: '1000',
        }),
      ).rejects.toThrow(
        'El cobro en efectivo no está habilitado en este establecimiento',
      );
    } finally {
      await enTenant((tx) =>
        tx.restaurante.update({
          where: { id: RESTAURANTE_ID },
          data: { efectivoHabilitado: true },
        }),
      );
    }

    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('PENDIENTE_PAGO');
    expect(estado.pagos).toHaveLength(0);
  });

  itConMozoYCocina(
    '[TC-I-117] HU-031: el mozo ve el pedido pendiente y lo cobra por HTTP; un monto menor da 400 y Cocina recibe 403',
    async () => {
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const pedidoId = await pedidoPendiente();
      const servidor = app.getHttpServer();

      const pendientes = await request(servidor)
        .get('/cobros/pendientes')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(200);
      expect(pendientes.body.efectivoHabilitado).toBe(true);
      expect(
        pendientes.body.pedidos.find((p: { id: string }) => p.id === pedidoId),
      ).toMatchObject({
        total: '590.00',
        mesa: { numero: NUMERO_MESA_TEST },
        pagoEnCurso: false,
      });

      const insuficiente = await request(servidor)
        .post('/cobros/efectivo')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({ pedidoId, idempotencyKey: randomUUID(), montoRecibido: '500' })
        .expect(400);
      expect(insuficiente.body.message).toContain('es menor que el total');

      await request(servidor)
        .post('/cobros/efectivo')
        .set('Authorization', `Bearer ${tokenCocina}`)
        .send({ pedidoId, idempotencyKey: randomUUID(), montoRecibido: '600' })
        .expect(403);

      const cobro = await request(servidor)
        .post('/cobros/efectivo')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({ pedidoId, idempotencyKey: randomUUID(), montoRecibido: '600' })
        .expect(201);
      expect(cobro.body.vuelto).toBe('10.00');

      const estado = await leer(pedidoId);
      expect(estado.pedido.estado).toBe('RECIBIDO');
    },
  );
});
