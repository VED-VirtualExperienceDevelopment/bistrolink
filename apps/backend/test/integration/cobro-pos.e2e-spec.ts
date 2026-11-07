import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { conPagoFalso } from './support/pago-falso';

// HU-007b (BL-80): registro de un cobro hecho con el POS del local.
//
// El CFE está apagado (conPagoFalso): no se llama a Surtec. Todo lo demás es
// real: base, RLS, transacción, historial y auditoría. El flujo es el mismo
// que el del efectivo (TC-I-113 a 117); acá se prueba lo propio del POS.
//
// Usa una mesa propia (número 76 del tenant A) para no tocar las del seed.
// Al terminar queda LIBRE.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const NUMERO_MESA_TEST = 76;
const ACTOR_PRUEBA = 'script:test-bl-80';

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

describe('HU-007b (BL-80): cobro con el POS del local', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let cobros: CobroEfectivoService;
  let mesaId: string;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const posHabilitado = (valor: boolean) =>
    enTenant((tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { posHabilitado: valor },
      }),
    );

  /** Un pedido de la mesa de prueba esperando el pago, de $ 590. */
  const pedidoPendiente = () =>
    enTenant<string>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-80-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'QR',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-80',
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
      pagos: {
        medioPago: string;
        estado: string;
        monto: Prisma.Decimal;
        pasarelaReferencia: string | null;
      }[];
      historial: { estadoNuevo: string }[];
      auditoria: {
        valoresDespues: unknown;
        detalle: unknown;
        actorKeycloakId: string;
      }[];
    }>(async (tx) => {
      const pagos = await tx.pago.findMany({
        where: { pedidoId },
        select: {
          id: true,
          medioPago: true,
          estado: true,
          monto: true,
          pasarelaReferencia: true,
        },
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
            accion: 'PAGO_POS_REGISTRADO',
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
    await posHabilitado(true).catch(() => undefined);
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-177] HU-007b: el cobro con el POS deja el pedido en RECIBIDO, el pago POS_DEBITO/APROBADO con el n.° de autorización y la auditoría; un reintento no duplica, otro tenant no lo ve y con el POS deshabilitado da 409', async () => {
    const pedidoId = await pedidoPendiente();
    const solicitud = {
      pedidoId,
      idempotencyKey: `bl-80-${randomUUID()}`,
      tarjeta: 'DEBITO' as const,
      autorizacion: 'A1B2C3',
    };

    // Otro tenant no encuentra el pedido (RLS) y no cobra nada.
    await expect(
      cobros.registrarPos(TENANT_B, ACTOR_PRUEBA, {
        ...solicitud,
        idempotencyKey: `bl-80-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const cobro = await cobros.registrarPos(TENANT_ID, ACTOR_PRUEBA, solicitud);
    expect(cobro).toMatchObject({
      pedidoId,
      monto: '590.00',
      tarjeta: 'DEBITO',
      autorizacion: 'A1B2C3',
    });

    // Reintento con la misma clave: el mismo cobro, sin duplicar nada.
    await expect(
      cobros.registrarPos(TENANT_ID, ACTOR_PRUEBA, solicitud),
    ).resolves.toEqual(cobro);

    const estado = await leer(pedidoId);
    expect(estado.pedido.estado).toBe('RECIBIDO');
    expect(estado.pagos).toHaveLength(1);
    expect(estado.pagos[0]).toMatchObject({
      medioPago: 'POS_DEBITO',
      estado: 'APROBADO',
      pasarelaReferencia: 'A1B2C3',
    });
    expect(estado.pagos[0].monto.toFixed(2)).toBe('590.00');
    expect(estado.historial).toEqual([{ estadoNuevo: 'RECIBIDO' }]);
    expect(estado.auditoria).toEqual([
      {
        actorKeycloakId: ACTOR_PRUEBA,
        valoresDespues: {
          monto: '590.00',
          tarjeta: 'Débito',
          autorizacion: 'A1B2C3',
        },
        detalle: { pedidoId },
      },
    ]);

    // Con el POS deshabilitado: 409 y el pedido sigue esperando el pago.
    const otro = await pedidoPendiente();
    await posHabilitado(false);
    try {
      await expect(
        cobros.registrarPos(TENANT_ID, ACTOR_PRUEBA, {
          ...solicitud,
          pedidoId: otro,
          idempotencyKey: `bl-80-${randomUUID()}`,
        }),
      ).rejects.toThrow(
        'El cobro con el POS del local no está habilitado en este establecimiento',
      );
    } finally {
      await posHabilitado(true);
    }
    expect((await leer(otro)).pedido.estado).toBe('PENDIENTE_PAGO');
  });

  itConMozoYCocina(
    '[TC-I-178] HU-007b: el mozo ve el POS habilitado y registra el cobro por HTTP; una autorización inválida da 400 y Cocina recibe 403',
    async () => {
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const pedidoId = await pedidoPendiente();
      const servidor = app.getHttpServer();

      const pendientes = await request(servidor)
        .get('/cobros/pendientes')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(200);
      expect(pendientes.body.posHabilitado).toBe(true);

      // Con 16 dígitos podría ser un número de tarjeta: no se acepta.
      await request(servidor)
        .post('/cobros/pos')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({
          pedidoId,
          idempotencyKey: randomUUID(),
          tarjeta: 'CREDITO',
          autorizacion: '4111111111111111',
        })
        .expect(400);

      await request(servidor)
        .post('/cobros/pos')
        .set('Authorization', `Bearer ${tokenCocina}`)
        .send({
          pedidoId,
          idempotencyKey: randomUUID(),
          tarjeta: 'CREDITO',
          autorizacion: '123456',
        })
        .expect(403);

      const cobro = await request(servidor)
        .post('/cobros/pos')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({
          pedidoId,
          idempotencyKey: randomUUID(),
          tarjeta: 'CREDITO',
          autorizacion: '123456',
        })
        .expect(201);
      expect(cobro.body).toMatchObject({
        monto: '590.00',
        tarjeta: 'CREDITO',
        autorizacion: '123456',
      });

      const estado = await leer(pedidoId);
      expect(estado.pedido.estado).toBe('RECIBIDO');
      expect(estado.pagos[0].medioPago).toBe('POS_CREDITO');
    },
  );
});
