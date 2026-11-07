import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { ConfiguracionEstablecimientoService } from '../../src/configuracion/configuracion-establecimiento.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { PagosService } from '../../src/pagos/pagos.service';
import { conPagoFalso } from './support/pago-falso';

// HU-020 (BL-72): configuración del establecimiento.
//
// Base, RLS, transacción y auditoría reales. El pago y el CFE son falsos
// (conPagoFalso). Cambia la configuración del restaurante del seed (tenant
// A) y la deja como estaba al terminar: los demás tests cuentan con el
// efectivo y Mercado Pago habilitados.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACCION = 'ESTABLECIMIENTO_CONFIGURACION_MODIFICADA';
const ACTOR_PRUEBA = 'script:test-bl-72';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const itConAdminYMozo =
  ADMIN_USER && ADMIN_PASS && MOZO_USER && MOZO_PASS ? it : it.skip;

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

/** Valores de la configuración que se guardan antes y se restauran después. */
interface Configuracion {
  razonSocial: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  propinasSugeridas: number[];
  cfeProveedor: 'SURTEC' | 'BILLER';
}

describe('HU-020 (BL-72): configuración del establecimiento', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let configuracion: ConfiguracionEstablecimientoService;
  let cobros: CobroEfectivoService;
  let pagos: PagosService;
  let original: Configuracion;
  // Registros de auditoría de este actor que ya existían antes de cada test
  // (no se pueden borrar: la auditoría es de solo agregar).
  let registrosPrevios: Set<string>;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const leerConfiguracion = () =>
    enTenant<Configuracion>(async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: TENANT_ID },
        select: { razonSocial: true },
      });
      const restaurante = await tx.restaurante.findUniqueOrThrow({
        where: { tenantId: TENANT_ID },
        select: {
          efectivoHabilitado: true,
          mercadoPagoHabilitado: true,
          plexoHabilitado: true,
          handyHabilitado: true,
          propinasSugeridas: true,
          cfeProveedor: true,
        },
      });
      return { ...tenant, ...restaurante };
    });

  const restaurar = () =>
    enTenant(async (tx) => {
      const { razonSocial, ...restaurante } = original;
      await tx.tenant.update({
        where: { id: TENANT_ID },
        data: { razonSocial },
      });
      await tx.restaurante.update({
        where: { tenantId: TENANT_ID },
        data: restaurante,
      });
    });

  interface Registro {
    id: string;
    actorKeycloakId: string;
    entidad: string;
    entidadId: string | null;
    valoresAntes: unknown;
    valoresDespues: unknown;
    detalle: unknown;
  }

  const registrosDelActor = () =>
    enTenant<Registro[]>((tx) =>
      tx.registroAuditoria.findMany({
        where: { accion: ACCION, actorKeycloakId: ACTOR_PRUEBA },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          actorKeycloakId: true,
          entidad: true,
          entidadId: true,
          valoresAntes: true,
          valoresDespues: true,
          detalle: true,
        },
      }),
    );

  /** Registros de esta acción y este actor que creó el test en curso. */
  const auditoria = async () =>
    (await registrosDelActor()).filter((r) => !registrosPrevios.has(r.id));

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts: sin él, el body llega sin validar
    // ni transformar (no se rechaza el RUT ni se ordenan las propinas).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    tenantPrisma = await app.resolve(TenantPrismaService);
    configuracion = await app.resolve(ConfiguracionEstablecimientoService);
    cobros = await app.resolve(CobroEfectivoService);
    pagos = await app.resolve(PagosService);
    original = await leerConfiguracion();
  }, 30000);

  beforeEach(async () => {
    registrosPrevios = new Set((await registrosDelActor()).map((r) => r.id));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await restaurar();
  });

  afterAll(async () => {
    await restaurar().catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-132] HU-020: el cambio queda guardado y auditado con antes y después; con el efectivo y Mercado Pago apagados, el cobro se rechaza con 409', async () => {
    const respuesta = await configuracion.actualizar(
      TENANT_ID,
      {
        efectivoHabilitado: false,
        mercadoPagoHabilitado: false,
        propinasSugeridas: [10, 15, 20],
      },
      { id: ACTOR_PRUEBA },
    );

    expect(respuesta).toMatchObject({
      efectivoHabilitado: false,
      mercadoPagoHabilitado: false,
      propinasSugeridas: [10, 15, 20],
    });
    expect(await leerConfiguracion()).toMatchObject({
      efectivoHabilitado: false,
      mercadoPagoHabilitado: false,
      propinasSugeridas: [10, 15, 20],
    });

    const registros = await auditoria();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      actorKeycloakId: ACTOR_PRUEBA,
      entidad: 'establecimiento',
      entidadId: TENANT_ID,
      valoresAntes: {
        efectivoHabilitado: original.efectivoHabilitado,
        mercadoPagoHabilitado: original.mercadoPagoHabilitado,
        propinasSugeridas: original.propinasSugeridas,
      },
      valoresDespues: {
        efectivoHabilitado: false,
        mercadoPagoHabilitado: false,
        propinasSugeridas: [10, 15, 20],
      },
    });

    // El efectivo apagado se controla antes de buscar el pedido: alcanza
    // con un id cualquiera.
    await expect(
      cobros.registrar(TENANT_ID, ACTOR_PRUEBA, {
        pedidoId: randomUUID(),
        idempotencyKey: `bl-72-${randomUUID()}`,
        montoRecibido: '1000',
      }),
    ).rejects.toThrow(
      'El cobro en efectivo no está habilitado en este establecimiento',
    );
    // Mercado Pago apagado: 409 antes de reservar el pago.
    await expect(
      pagos.crear(TENANT_ID, {
        pedidoId: randomUUID(),
        idempotencyKey: `bl-72-${randomUUID()}`,
        medioPago: 'MERCADOPAGO',
        datosPasarela: {},
      }),
    ).rejects.toThrow('Este local no acepta pagos con Mercado Pago');
  });

  it('[TC-I-133] HU-020: si la auditoría falla, el cambio no se guarda (misma transacción)', async () => {
    // El AuditLogService que usa el servicio de configuración.
    const auditLog = (configuracion as any).auditLog;
    jest
      .spyOn(auditLog, 'registrarEnTx')
      .mockRejectedValueOnce(new Error('auditoría caída'));

    await expect(
      configuracion.actualizar(
        TENANT_ID,
        { mercadoPagoHabilitado: !original.mercadoPagoHabilitado },
        { id: ACTOR_PRUEBA },
      ),
    ).rejects.toThrow('auditoría caída');

    expect(await leerConfiguracion()).toEqual(original);
    expect(await auditoria()).toHaveLength(0);
  });

  it('[TC-I-134] HU-020: la base rechaza propinas fuera de rango aunque no pasen por la API (CHECK)', async () => {
    // El CHECK de la migración (código 23514 de Postgres).
    await expect(
      enTenant((tx) =>
        tx.restaurante.update({
          where: { tenantId: TENANT_ID },
          data: { propinasSugeridas: [0, 150] },
        }),
      ),
    ).rejects.toThrow(/restaurante_propinas_sugeridas_validas|23514/);

    expect((await leerConfiguracion()).propinasSugeridas).toEqual(
      original.propinasSugeridas,
    );
  });

  itConAdminYMozo(
    '[TC-I-135] HU-020: el admin lee y cambia la configuración por HTTP; el RUT y Handy dan 400 y el mozo recibe 403',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER!, ADMIN_PASS!);
      const tokenMozo = await getToken(MOZO_USER!, MOZO_PASS!);
      const servidor = app.getHttpServer();

      const lectura = await request(servidor)
        .get('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(lectura.body).toMatchObject({
        razonSocial: original.razonSocial,
        efectivoHabilitado: original.efectivoHabilitado,
        // HU-007b (BL-80): el POS del local también se puede habilitar.
        mediosPagoDisponibles: ['EFECTIVO', 'MERCADOPAGO', 'POS'],
        proveedoresCfeDisponibles: ['SURTEC'],
      });
      expect(typeof lectura.body.rut).toBe('string');

      const cambio = await request(servidor)
        .patch('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ propinasSugeridas: [20, 10] })
        .expect(200);
      expect(cambio.body.propinasSugeridas).toEqual([10, 20]);

      await request(servidor)
        .patch('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ rut: '211234560019' })
        .expect(400);
      await request(servidor)
        .patch('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ handyHabilitado: true })
        .expect(400);
      // BL-452: Plexo quedó fuera del MVP, igual que Handy.
      await request(servidor)
        .patch('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ plexoHabilitado: true })
        .expect(400);

      await request(servidor)
        .get('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .expect(403);
      await request(servidor)
        .patch('/admin/configuracion')
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({ efectivoHabilitado: false })
        .expect(403);

      expect((await leerConfiguracion()).efectivoHabilitado).toBe(
        original.efectivoHabilitado,
      );
    },
  );
});
