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
import { MenuService } from '../../src/menu/menu.service';
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
  // HU-043 (BL-561): también se restauran al terminar cada test.
  nombre: string;
  direccion: string;
  efectivoHabilitado: boolean;
  mercadoPagoHabilitado: boolean;
  plexoHabilitado: boolean;
  handyHabilitado: boolean;
  propinasSugeridas: number[];
  cfeProveedor: 'SURTEC' | 'BILLER';
  // HU-038 (BL-506): también se restauran al terminar cada test.
  minutosEsperaAtencion: number;
  minutosEsperaDemorado: number;
  minutosEsperaDemoraAlta: number;
  // HU-043 (BL-531): también se restaura al terminar cada test.
  plantilla: string;
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
          nombre: true,
          direccion: true,
          efectivoHabilitado: true,
          mercadoPagoHabilitado: true,
          plexoHabilitado: true,
          handyHabilitado: true,
          propinasSugeridas: true,
          cfeProveedor: true,
          minutosEsperaAtencion: true,
          minutosEsperaDemorado: true,
          minutosEsperaDemoraAlta: true,
          plantilla: true,
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

  it('[TC-I-192] HU-038 (BL-506): los umbrales de espera se guardan, se auditan y se avisan al KDS', async () => {
    // El KdsGateway que usa el servicio de configuración.
    const kdsGateway = (configuracion as any).kdsGateway;
    const aviso = jest.spyOn(kdsGateway, 'emitirUmbralesEspera');

    const respuesta = await configuracion.actualizar(
      TENANT_ID,
      {
        minutosEsperaAtencion: 15,
        minutosEsperaDemorado: 45,
        minutosEsperaDemoraAlta: 90,
      },
      { id: ACTOR_PRUEBA },
    );

    expect(respuesta).toMatchObject({
      minutosEsperaAtencion: 15,
      minutosEsperaDemorado: 45,
      minutosEsperaDemoraAlta: 90,
    });
    expect(await leerConfiguracion()).toMatchObject({
      minutosEsperaAtencion: 15,
      minutosEsperaDemorado: 45,
      minutosEsperaDemoraAlta: 90,
    });
    const registros = await auditoria();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      valoresAntes: {
        minutosEsperaAtencion: original.minutosEsperaAtencion,
        minutosEsperaDemorado: original.minutosEsperaDemorado,
        minutosEsperaDemoraAlta: original.minutosEsperaDemoraAlta,
      },
      valoresDespues: {
        minutosEsperaAtencion: 15,
        minutosEsperaDemorado: 45,
        minutosEsperaDemoraAlta: 90,
      },
    });
    expect(aviso).toHaveBeenCalledWith(TENANT_ID, {
      atencion: 15,
      demorado: 45,
      demoraAlta: 90,
    });
  });

  it('[TC-I-193] HU-038 (BL-506): umbrales fuera de orden: la API da 400 y la base los rechaza aunque no pasen por la API (CHECK)', async () => {
    // Por el servicio: 400 con lo guardado (el PATCH es parcial).
    await expect(
      configuracion.actualizar(
        TENANT_ID,
        { minutosEsperaDemoraAlta: original.minutosEsperaDemorado },
        { id: ACTOR_PRUEBA },
      ),
    ).rejects.toThrow(
      '«Demora alta desde» tiene que ser mayor que «Demorado desde»',
    );
    expect(await auditoria()).toHaveLength(0);

    // Directo a la base: el CHECK de la migración (23514 de Postgres).
    await expect(
      enTenant((tx) =>
        tx.restaurante.update({
          where: { tenantId: TENANT_ID },
          data: { minutosEsperaAtencion: 90, minutosEsperaDemorado: 60 },
        }),
      ),
    ).rejects.toThrow(/restaurante_minutos_espera_orden|23514/);
    await expect(
      enTenant((tx) =>
        tx.restaurante.update({
          where: { tenantId: TENANT_ID },
          data: { minutosEsperaDemoraAlta: 601 },
        }),
      ),
    ).rejects.toThrow(/restaurante_minutos_espera_rango|23514/);

    expect(await leerConfiguracion()).toEqual(original);
  });

  it('[TC-I-217] HU-043 (BL-531): la plantilla de marca se guarda y se audita; la base rechaza una que no está en la lista (CHECK)', async () => {
    const otra = original.plantilla === 'gourmet' ? 'familiar' : 'gourmet';

    const respuesta = await configuracion.actualizar(
      TENANT_ID,
      { plantilla: otra },
      { id: ACTOR_PRUEBA },
    );

    expect(respuesta).toMatchObject({
      plantilla: otra,
      plantillasDisponibles: ['clasica', 'gourmet', 'rapida', 'familiar'],
    });
    expect((await leerConfiguracion()).plantilla).toBe(otra);
    const registros = await auditoria();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      detalle: { campos: ['plantilla'] },
      valoresAntes: { plantilla: original.plantilla },
      valoresDespues: { plantilla: otra },
    });

    // Directo a la base: el CHECK de la migración (23514 de Postgres).
    await expect(
      enTenant((tx) =>
        tx.restaurante.update({
          where: { tenantId: TENANT_ID },
          data: { plantilla: 'azul' },
        }),
      ),
    ).rejects.toThrow(/restaurante_plantilla_valida|23514/);
    expect((await leerConfiguracion()).plantilla).toBe(otra);
  });

  it('[TC-I-219] HU-043 (BL-561): el Administrador cambia el nombre y la dirección del local; se auditan y la carta los muestra', async () => {
    const nombre = `${original.nombre} (cambiado)`;
    const direccion = `${original.direccion} bis`;

    const respuesta = await configuracion.actualizar(
      TENANT_ID,
      { nombre, direccion },
      { id: ACTOR_PRUEBA },
    );

    expect(respuesta).toMatchObject({ nombre, direccion });
    expect(await leerConfiguracion()).toMatchObject({ nombre, direccion });
    const registros = await auditoria();
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({
      detalle: { campos: ['nombre', 'direccion'] },
      valoresAntes: { nombre: original.nombre, direccion: original.direccion },
      valoresDespues: { nombre, direccion },
    });

    // La carta pública (HU-002) toma el nombre y la dirección nuevos.
    const restauranteId = await enTenant<string>(async (tx) => {
      const restaurante = await tx.restaurante.findUniqueOrThrow({
        where: { tenantId: TENANT_ID },
        select: { id: true },
      });
      return restaurante.id;
    });
    const menuService = await app.resolve(MenuService);
    const menu = await menuService.getMenuByRestaurante(
      TENANT_ID,
      restauranteId,
    );
    expect(menu.restaurante).toMatchObject({ nombre, direccion });
  });

  it('[TC-I-218] HU-043 (BL-532): una key de otro tenant, de la cuarentena o de un ítem no se guarda como logo (400, sin auditoría)', async () => {
    const uuid = randomUUID();
    const logoAntes = await enTenant<string | null>(async (tx) => {
      const restaurante = await tx.restaurante.findUniqueOrThrow({
        where: { tenantId: TENANT_ID },
        select: { logoKey: true },
      });
      return restaurante.logoKey;
    });

    for (const logoKey of [
      `b02579f2-2bb0-496b-abf2-33c494c93122/menu/marca/${uuid}.webp`,
      `incoming/${TENANT_ID}/${uuid}`,
      `${TENANT_ID}/menu/${uuid}.webp`,
    ]) {
      await expect(
        configuracion.actualizar(TENANT_ID, { logoKey }, { id: ACTOR_PRUEBA }),
      ).rejects.toThrow('El logo no es válido para este establecimiento');
    }

    expect(await auditoria()).toHaveLength(0);
    const logoDespues = await enTenant<string | null>(async (tx) => {
      const restaurante = await tx.restaurante.findUniqueOrThrow({
        where: { tenantId: TENANT_ID },
        select: { logoKey: true },
      });
      return restaurante.logoKey;
    });
    expect(logoDespues).toBe(logoAntes);
  });

  it('[TC-I-220] HU-043 (BL-562): el logo, la foto de un ítem o una portada de otro tenant no se guardan como portada (400, sin auditoría)', async () => {
    const uuid = randomUUID();
    const leerPortada = () =>
      enTenant<string | null>(async (tx) => {
        const restaurante = await tx.restaurante.findUniqueOrThrow({
          where: { tenantId: TENANT_ID },
          select: { portadaKey: true },
        });
        return restaurante.portadaKey;
      });
    const portadaAntes = await leerPortada();

    for (const portadaKey of [
      `b02579f2-2bb0-496b-abf2-33c494c93122/menu/portada/${uuid}.webp`,
      `${TENANT_ID}/menu/marca/${uuid}.webp`,
      `${TENANT_ID}/menu/${uuid}.webp`,
      `incoming/${TENANT_ID}/${uuid}`,
    ]) {
      await expect(
        configuracion.actualizar(
          TENANT_ID,
          { portadaKey },
          { id: ACTOR_PRUEBA },
        ),
      ).rejects.toThrow('La portada no es válida para este establecimiento');
    }

    expect(await auditoria()).toHaveLength(0);
    expect(await leerPortada()).toBe(portadaAntes);
  });
});
