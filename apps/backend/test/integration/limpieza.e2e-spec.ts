import 'dotenv/config';
// Antes que AppModule: habilita el módulo de limpieza (E2E_CLEANUP_ENABLED).
import './support/habilitar-limpieza';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MesaEstado, PedidoEstado, Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import {
  buscarUsuarioKeycloak,
  borrarUsuarioKeycloak,
  crearUsuarioPlataforma,
  pedirToken,
  rutDePrueba,
} from './support/plataforma';

// BL-476 (BL-285, ADR 0011): limpieza de los datos de prueba con base, RLS,
// Keycloak y auditoría reales.
//
// Cada área se prueba con datos propios que llevan la marca de los E2E y
// se comprueba que lo que no tiene la marca no cambia. La limpieza deja el
// tenant A como el seed (mesas 1 y 2 abiertas, carta y configuración del
// seed), que es como lo esperan las demás suites. Corre con --runInBand:
// ninguna otra suite toca la base a la vez.
//
// Setup: TEST_ADMIN_PASSWORD y TEST_MOZO_PASSWORD (como usuarios.e2e-spec);
// el caso de establecimientos necesita además KEYCLOAK_COMENSAL_PASSWORD
// (como plataforma-gestion.e2e-spec).

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';
const MESA_A1 = '33333333-3333-3333-3333-333333333333';
const MESA_A2 = '33333333-3333-3333-3333-333333333334';
const CATEGORIA_PLATOS = '44444444-4444-4444-4444-444444444444';
const MILANESA = '55555555-5555-5555-5555-555555555555';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const MOZO_USER = process.env.TEST_MOZO_USERNAME ?? 'mozo-test';
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const COMENSAL_PASS = process.env.KEYCLOAK_COMENSAL_PASSWORD;

const itConAdmin = ADMIN_PASS ? it : it.skip;
const itConAdminYMozo = ADMIN_PASS && MOZO_PASS ? it : it.skip;
const itConPlataforma = COMENSAL_PASS && ADMIN_PASS ? it : it.skip;

const SUFIJO = Date.now().toString().slice(-8);
const RUTA = '/testing/limpieza';

describe('BL-285: limpieza de los datos de prueba (base real)', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let tokenAdmin: string;
  const pedidosCreados: string[] = [];
  const usuariosKeycloak: string[] = [];

  const api = () => request(app.getHttpServer());
  const comoAdmin = (body: Record<string, unknown>) =>
    api().post(RUTA).set('Authorization', `Bearer ${tokenAdmin}`).send(body);

  const enTenant = <T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => tenantPrisma.runInTenantContext(tenantId, fn as never) as Promise<T>;

  async function crearPedido(
    estado: PedidoEstado,
    extra: Partial<Prisma.PedidoUncheckedCreateInput> = {},
  ): Promise<string> {
    const id = randomUUID();
    pedidosCreados.push(id);
    await enTenant(TENANT_A, (tx) =>
      tx.pedido.create({
        data: {
          id,
          tenantId: TENANT_A,
          restauranteId: RESTAURANTE_A,
          mesaId: MESA_A1,
          idempotencyKey: `bl-476-${randomUUID()}`,
          estado,
          canal: 'QR',
          ...extra,
        },
      }),
    );
    return id;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    if (ADMIN_PASS) tokenAdmin = await pedirToken(ADMIN_USER, ADMIN_PASS);
  }, 30000);

  afterAll(async () => {
    // Datos propios del test: el historial y los pedidos (en la aplicación
    // la limpieza no borra, pero el test sí borra lo que creó).
    await enTenant(TENANT_A, async (tx) => {
      await tx.pedidoEstadoHistorial.deleteMany({
        where: { pedidoId: { in: pedidosCreados } },
      });
      await tx.pedido.deleteMany({ where: { id: { in: pedidosCreados } } });
    }).catch(() => undefined);
    for (const username of usuariosKeycloak) {
      await borrarUsuarioKeycloak(username).catch(() => undefined);
    }
    await app.close();
  }, 30000);

  itConAdmin(
    '[TC-I-168] BL-475: los pedidos indicados se cierran (sin pagar → CANCELADO, pagado → ENTREGADO) con historial y auditoría; dry-run no cambia nada',
    async () => {
      const sinPagar = await crearPedido(PedidoEstado.PENDIENTE_PAGO, {
        efectivoSolicitadoEn: new Date(),
      });
      const enCocina = await crearPedido(PedidoEstado.RECIBIDO);
      const ajeno = await crearPedido(PedidoEstado.RECIBIDO);
      const body = { areas: ['pedidos'], pedidoIds: [sinPagar, enCocina] };

      const simulacion = await comoAdmin({ ...body, dryRun: true }).expect(200);
      expect(simulacion.body).toEqual({
        dryRun: true,
        pedidos: {
          encontrados: { PENDIENTE_PAGO: 1, RECIBIDO: 1 },
          cancelados: 1,
          entregados: 1,
        },
      });
      const estados = () =>
        enTenant(TENANT_A, (tx) =>
          tx.pedido.findMany({
            where: { id: { in: [sinPagar, enCocina, ajeno] } },
            select: { id: true, estado: true },
          }),
        ).then((filas) =>
          Object.fromEntries(filas.map((f) => [f.id, f.estado])),
        );
      expect(await estados()).toEqual({
        [sinPagar]: PedidoEstado.PENDIENTE_PAGO,
        [enCocina]: PedidoEstado.RECIBIDO,
        [ajeno]: PedidoEstado.RECIBIDO,
      });

      await comoAdmin(body).expect(200);

      expect(await estados()).toEqual({
        [sinPagar]: PedidoEstado.CANCELADO,
        [enCocina]: PedidoEstado.ENTREGADO,
        [ajeno]: PedidoEstado.RECIBIDO, // no estaba en la lista
      });
      const historial = await enTenant(TENANT_A, (tx) =>
        tx.pedidoEstadoHistorial.findMany({
          where: { pedidoId: { in: [sinPagar, enCocina] } },
          select: { pedidoId: true, estadoAnterior: true, estadoNuevo: true },
        }),
      );
      expect(historial).toEqual(
        expect.arrayContaining([
          {
            pedidoId: sinPagar,
            estadoAnterior: PedidoEstado.PENDIENTE_PAGO,
            estadoNuevo: PedidoEstado.CANCELADO,
          },
          {
            pedidoId: enCocina,
            estadoAnterior: PedidoEstado.RECIBIDO,
            estadoNuevo: PedidoEstado.ENTREGADO,
          },
        ]),
      );
      const auditados = await enTenant(TENANT_A, (tx) =>
        tx.registroAuditoria.count({
          where: {
            accion: 'PEDIDO_LIMPIEZA_PRUEBAS',
            detalle: { path: ['pedidos'], array_contains: [sinPagar] },
          },
        }),
      );
      expect(auditados).toBe(1);
    },
  );

  itConAdmin(
    '[TC-I-169] BL-479: la mesa temporal y la zona «Zona E2E» se van, la mesa 2 vuelve a estar abierta y las demás zonas quedan',
    async () => {
      const temporal = randomUUID();
      const planoOriginal = await enTenant(TENANT_A, async (tx) => {
        await tx.mesa.create({
          data: {
            id: temporal,
            tenantId: TENANT_A,
            restauranteId: RESTAURANTE_A,
            numero: 77,
            estado: MesaEstado.LIBRE,
          },
        });
        await tx.mesa.update({
          where: { id: MESA_A2 },
          data: {
            estado: MesaEstado.REQUIERE_LIMPIEZA,
            sesionId: null,
            sesionAbiertaEn: null,
          },
        });
        const { plano } = await tx.restaurante.findUniqueOrThrow({
          where: { id: RESTAURANTE_A },
          select: { plano: true },
        });
        const base = (plano ?? {}) as { zonas?: unknown[] };
        await tx.restaurante.update({
          where: { id: RESTAURANTE_A },
          data: {
            plano: {
              ...base,
              zonas: [
                ...(base.zonas ?? []),
                { id: `z-${SUFIJO}`, etiqueta: `Zona E2E ${SUFIJO}` },
                { id: `p-${SUFIJO}`, etiqueta: `Patio ${SUFIJO}` },
              ],
            } as Prisma.InputJsonValue,
          },
        });
        return plano;
      });

      try {
        const res = await comoAdmin({ areas: ['mesas'] }).expect(200);
        expect(res.body.mesas.eliminadas).toBeGreaterThanOrEqual(1);
        expect(res.body.mesas.zonasEliminadas).toBeGreaterThanOrEqual(1);

        const despues = await enTenant(TENANT_A, async (tx) => ({
          temporal: await tx.mesa.findUnique({ where: { id: temporal } }),
          mesa2: await tx.mesa.findUniqueOrThrow({
            where: { id: MESA_A2 },
            select: { estado: true, sesionId: true },
          }),
          plano: (
            await tx.restaurante.findUniqueOrThrow({
              where: { id: RESTAURANTE_A },
              select: { plano: true },
            })
          ).plano as { zonas: { etiqueta: string }[] },
        }));
        expect(despues.temporal).toBeNull();
        expect(despues.mesa2.estado).toBe(MesaEstado.OCUPADA);
        expect(despues.mesa2.sesionId).not.toBeNull();
        const etiquetas = despues.plano.zonas.map((z) => z.etiqueta);
        expect(etiquetas).toContain(`Patio ${SUFIJO}`);
        expect(etiquetas).not.toContain(`Zona E2E ${SUFIJO}`);
      } finally {
        // El plano vuelve a como estaba (sin el «Patio» del test).
        await enTenant(TENANT_A, async (tx) => {
          await tx.mesa.deleteMany({ where: { id: temporal } });
          await tx.restaurante.update({
            where: { id: RESTAURANTE_A },
            data: {
              plano:
                planoOriginal === null
                  ? Prisma.DbNull
                  : (planoOriginal as Prisma.InputJsonValue),
            },
          });
        });
      }
    },
  );

  itConAdmin(
    '[TC-I-170] BL-480: la categoría «E2E» y su ítem se borran, la Milanesa vuelve a su precio y sin control de stock, y un ítem sin marca no cambia',
    async () => {
      const categoria = randomUUID();
      const itemE2E = randomUUID();
      const itemReal = randomUUID();
      await enTenant(TENANT_A, async (tx) => {
        await tx.categoriaCarta.create({
          data: {
            id: categoria,
            tenantId: TENANT_A,
            restauranteId: RESTAURANTE_A,
            nombre: `E2E carta ${SUFIJO}`,
            orden: 999,
          },
        });
        await tx.itemCarta.create({
          data: {
            id: itemE2E,
            tenantId: TENANT_A,
            categoriaId: categoria,
            nombre: `Chivito ${SUFIJO}`,
            precio: 100,
            orden: 1,
          },
        });
        await tx.itemCarta.create({
          data: {
            id: itemReal,
            tenantId: TENANT_A,
            categoriaId: CATEGORIA_PLATOS,
            nombre: `Flan casero ${SUFIJO}`,
            precio: 150,
            orden: 999,
          },
        });
        await tx.itemCarta.update({
          where: { id: MILANESA },
          data: { precio: 600, controlaStock: true, stockActual: 3 },
        });
      });

      try {
        const res = await comoAdmin({ areas: ['carta'] }).expect(200);
        expect(res.body.carta.itemsEliminados).toBeGreaterThanOrEqual(1);
        expect(res.body.carta.categoriasEliminadas).toBeGreaterThanOrEqual(1);

        const despues = await enTenant(TENANT_A, async (tx) => ({
          categoria: await tx.categoriaCarta.findUnique({
            where: { id: categoria },
          }),
          itemE2E: await tx.itemCarta.findUnique({ where: { id: itemE2E } }),
          itemReal: await tx.itemCarta.findUnique({
            where: { id: itemReal },
            select: { precio: true, archivadoEn: true },
          }),
          milanesa: await tx.itemCarta.findUniqueOrThrow({
            where: { id: MILANESA },
            select: { precio: true, controlaStock: true, stockActual: true },
          }),
        }));
        expect(despues.categoria).toBeNull();
        expect(despues.itemE2E).toBeNull();
        expect(despues.itemReal).toEqual({
          precio: new Prisma.Decimal(150),
          archivadoEn: null,
        });
        expect(despues.milanesa).toEqual({
          precio: new Prisma.Decimal(590),
          controlaStock: false,
          stockActual: 0,
        });
      } finally {
        await enTenant(TENANT_A, (tx) =>
          tx.itemCarta.deleteMany({ where: { id: itemReal } }),
        );
      }
    },
  );

  itConAdmin(
    '[TC-I-171] BL-481: la configuración vuelve al seed sin tocar el correo de privacidad, y el usuario «e2e-…» se borra de la base y de Keycloak',
    async () => {
      const correoAntes = await enTenant(TENANT_A, async (tx) => {
        const { emailPrivacidad } = await tx.restaurante.findUniqueOrThrow({
          where: { tenantId: TENANT_A },
          select: { emailPrivacidad: true },
        });
        await tx.restaurante.update({
          where: { tenantId: TENANT_A },
          data: {
            mercadoPagoHabilitado: false,
            propinasSugeridas: [10, 15],
            limitePedidosEnPreparacion: 3,
          },
        });
        return emailPrivacidad;
      });
      const username = `e2e-limpieza-${SUFIJO}`;
      usuariosKeycloak.push(username);
      await api()
        .post('/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          username,
          email: `${username}@prueba.bistrolink.local`,
          nombre: 'Prueba',
          apellido: 'Limpieza',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_A,
        })
        .expect(201);

      const res = await comoAdmin({
        areas: ['configuracion', 'usuarios'],
      }).expect(200);

      expect(res.body.configuracion.camposRestablecidos).toEqual(
        expect.arrayContaining([
          'mercadoPagoHabilitado',
          'propinasSugeridas',
          'limitePedidosEnPreparacion',
        ]),
      );
      expect(res.body.configuracion.camposRestablecidos).not.toContain(
        'emailPrivacidad',
      );
      expect(res.body.usuarios.eliminados).toBeGreaterThanOrEqual(1);
      expect(res.body.usuarios.conError).toBe(0);

      const restaurante = await enTenant(TENANT_A, (tx) =>
        tx.restaurante.findUniqueOrThrow({
          where: { tenantId: TENANT_A },
          select: {
            mercadoPagoHabilitado: true,
            propinasSugeridas: true,
            limitePedidosEnPreparacion: true,
            emailPrivacidad: true,
          },
        }),
      );
      expect(restaurante).toEqual({
        mercadoPagoHabilitado: true,
        propinasSugeridas: [],
        limitePedidosEnPreparacion: null,
        emailPrivacidad: correoAntes,
      });
      expect(
        await enTenant(TENANT_A, (tx) =>
          tx.usuario.findFirst({ where: { username } }),
        ),
      ).toBeNull();
      expect(await buscarUsuarioKeycloak(username)).toBeUndefined();
      // El Admin del seed sigue entrando.
      await pedirToken(ADMIN_USER, ADMIN_PASS as string);
    },
  );

  itConAdminYMozo(
    '[TC-I-172] BL-475: sin token responde 401, un Mozo recibe 403 y un Admin no puede usar la ruta de plataforma',
    async () => {
      await api().post(RUTA).send({ dryRun: true }).expect(401);

      const tokenMozo = await pedirToken(MOZO_USER, MOZO_PASS as string);
      await api()
        .post(RUTA)
        .set('Authorization', `Bearer ${tokenMozo}`)
        .send({ dryRun: true })
        .expect(403);

      const plataforma = await api()
        .post(`${RUTA}/establecimientos`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ dryRun: true });
      expect([401, 403]).toContain(plataforma.status);

      await comoAdmin({ areas: ['otra'] }).expect(400);
    },
  );

  itConPlataforma(
    '[TC-I-173] BL-482: el establecimiento «E2E Plataforma» sin pedidos se elimina (base y Keycloak) y los tenants de testing quedan',
    async () => {
      const usuarioPlataforma = `dev-l${SUFIJO}-plataforma`;
      const adminAlta = `e2e-l-admin-${SUFIJO}`;
      const cocinaAlta = `e2e-l-cocina-${SUFIJO}`;
      usuariosKeycloak.push(usuarioPlataforma, adminAlta, cocinaAlta);
      const tokenPlataforma = await crearUsuarioPlataforma(
        usuarioPlataforma,
        `Plataforma-${SUFIJO}`,
      );
      const rut = rutDePrueba(String(Number(SUFIJO.slice(-6)) + 700_000));
      const alta = await api()
        .post('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${tokenPlataforma}`)
        .send({
          razonSocial: `E2E Plataforma ${SUFIJO} SRL`,
          rut,
          restaurante: {
            nombre: `E2E Plataforma ${SUFIJO}`,
            direccion: 'Calle de Prueba 789',
          },
          admin: {
            username: adminAlta,
            email: `${adminAlta}@prueba.bistrolink.local`,
            nombre: 'Admin',
            apellido: 'Limpieza',
          },
          cocina: { username: cocinaAlta },
        })
        .expect(201);
      const tenantId = alta.body.tenantId as string;

      const simulacion = await api()
        .post(`${RUTA}/establecimientos`)
        .set('Authorization', `Bearer ${tokenPlataforma}`)
        .send({ dryRun: true })
        .expect(200);
      expect(simulacion.body.eliminados).toBeGreaterThanOrEqual(1);
      expect(await buscarUsuarioKeycloak(adminAlta)).toBeDefined();

      const res = await api()
        .post(`${RUTA}/establecimientos`)
        .set('Authorization', `Bearer ${tokenPlataforma}`)
        .send({})
        .expect(200);
      expect(res.body.conError).toBe(0);

      const tenants = await tenantPrisma.runInTenantContext(
        randomUUID(),
        (tx) =>
          tx.tenant.findMany({
            where: { id: { in: [tenantId, TENANT_A] } },
            select: { id: true },
          }),
      );
      expect(tenants.map((t) => t.id)).toEqual([TENANT_A]);
      expect(await buscarUsuarioKeycloak(adminAlta)).toBeUndefined();
      expect(await buscarUsuarioKeycloak(cocinaAlta)).toBeUndefined();
    },
  );

  it('[TC-I-174] BL-475: sin E2E_CLEANUP_ENABLED las rutas de limpieza no existen (404)', async () => {
    const anterior = process.env.E2E_CLEANUP_ENABLED;
    delete process.env.E2E_CLEANUP_ENABLED;
    let appSinLimpieza: INestApplication | undefined;
    try {
      // Registro de módulos aparte: AppModule se vuelve a cargar sin la
      // variable, como en producción.
      await jest.isolateModulesAsync(async () => {
        const { Test: TestAislado } = await import('@nestjs/testing');
        const { AppModule: AppSinLimpieza } =
          await import('../../src/app.module');
        const ref = await TestAislado.createTestingModule({
          imports: [AppSinLimpieza],
        }).compile();
        appSinLimpieza = ref.createNestApplication();
        await appSinLimpieza.init();
      });
      const servidor = (appSinLimpieza as INestApplication).getHttpServer();
      await request(servidor).post(RUTA).send({}).expect(404);
      await request(servidor)
        .post(`${RUTA}/establecimientos`)
        .send({})
        .expect(404);
    } finally {
      if (anterior === undefined) delete process.env.E2E_CLEANUP_ENABLED;
      else process.env.E2E_CLEANUP_ENABLED = anterior;
      await appSinLimpieza?.close();
    }
  }, 30000);
});
