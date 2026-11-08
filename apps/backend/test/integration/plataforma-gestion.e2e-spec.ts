import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import {
  borrarUsuarioKeycloak,
  buscarUsuarioKeycloak,
  claims,
  crearUsuarioPlataforma,
  fijarContrasena,
  intentarToken,
  pedirToken,
  rutConVerificadorIncorrecto,
  rutDePrueba,
  tenantIdEnKeycloak,
} from './support/plataforma';

/**
 * BL-416 (BL-404): gestión de establecimientos por la plataforma, contra la
 * base y el Keycloak reales.
 *
 * Sobre un establecimiento creado acá, en orden:
 * - Permisos: un token de tenant recibe 403 en cada ruta de gestión.
 * - RUT: el dígito verificador (alta y edición) y el RUT de otro
 *   establecimiento (409).
 * - Ficha y listado (BL-411, BL-418: `eliminable`).
 * - Suspender (BL-413): 403 con ESTABLECIMIENTO_SUSPENDIDO para Admin,
 *   Cocina y comensal, el menú público y el token del comensal. Reactivar:
 *   vuelve a operar.
 * - Acceso del Administrador (BL-414): solo dentro del establecimiento
 *   indicado.
 * - Eliminar (BL-418): con un pedido, 409 sin borrar nada; RUT equivocado,
 *   400; sin actividad, se borra en la base y en Keycloak y sus usuarios ya
 *   no ingresan.
 *
 * El último test elimina el establecimiento. afterAll borra lo que haya
 * quedado (usuarios de Keycloak y filas), aunque algún test falle.
 *
 * Setup: igual que plataforma.e2e-spec.ts (rol PLATAFORMA en el realm y
 * KEYCLOAK_COMENSAL_PASSWORD). Los permisos cruzados usan además el Admin
 * del seed (TEST_ADMIN_PASSWORD).
 */

const ADMIN_SEED = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const ADMIN_SEED_PASS = process.env.TEST_ADMIN_PASSWORD;
const COMENSAL_PASS = process.env.KEYCLOAK_COMENSAL_PASSWORD;

// Datos únicos por corrida. El RUT sale de otra semilla que el de
// plataforma.e2e-spec.ts: los dos archivos pueden correr a la vez.
const SUFIJO = Date.now().toString().slice(-10);
const RUT = rutDePrueba(String(Number(SUFIJO.slice(-6)) + 500_000));
const USUARIO_PLATAFORMA = `dev-g${SUFIJO}-plataforma`;
const PASSWORD_PLATAFORMA = `Plataforma-${SUFIJO}`;
const ADMIN = `e2e-g-admin-${SUFIJO}`;
const COCINA = `e2e-g-cocina-${SUFIJO}`;
const ADMIN_AGREGADO = `e2e-g-admin2-${SUFIJO}`;
// Contraseña definitiva para pedir tokens de Admin y Cocina (las del alta
// son temporales).
const CLAVE_TEST = `Clave-${SUFIJO}`;

const ALTA = {
  razonSocial: `Gestion e2e ${SUFIJO} SRL`,
  rut: RUT,
  restaurante: {
    nombre: `Gestion e2e ${SUFIJO}`,
    direccion: 'Calle de Prueba 456',
  },
  admin: {
    username: ADMIN,
    email: `${ADMIN}@prueba.bistrolink.local`,
    nombre: 'Admin',
    apellido: 'Gestion',
  },
  cocina: { username: COCINA },
};

const RUTA = '/plataforma/establecimientos';

describe('Gestión de establecimientos por la plataforma (BL-404) - e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenPlataforma: string;
  // Queda sin asignar si el alta del beforeAll falla (afterAll lo contempla).
  let tenantId: string;
  let restauranteId: string;
  let mesaVirtualId: string;

  const itConPlataforma = COMENSAL_PASS ? it : it.skip;
  const itConAdminSeed = COMENSAL_PASS && ADMIN_SEED_PASS ? it : it.skip;

  // Filas de un tenant, leídas o escritas con su contexto (RLS).
  async function enTenant<T>(
    id: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
      return fn(tx);
    });
  }

  const api = () => request(app.getHttpServer());
  const comoPlataforma = <T extends request.Test>(req: T) =>
    req.set('Authorization', `Bearer ${tokenPlataforma}`);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = new PrismaClient();

    if (!COMENSAL_PASS) return;

    tokenPlataforma = await crearUsuarioPlataforma(
      USUARIO_PLATAFORMA,
      PASSWORD_PLATAFORMA,
    );
    const alta = await comoPlataforma(api().post(RUTA)).send(ALTA);
    if (alta.status !== 201) {
      throw new Error(`No se pudo dar el alta del test: ${alta.status}`);
    }
    ({ tenantId, restauranteId, mesaVirtualId } = alta.body);
    await fijarContrasena(ADMIN, CLAVE_TEST);
    await fijarContrasena(COCINA, CLAVE_TEST);
  });

  afterAll(async () => {
    // Best-effort: cada paso por separado, para que uno que falle no corte
    // el resto de la limpieza. Si el alta se cortó antes de devolver el id,
    // el tenant se busca por el RUT de la corrida.
    const id =
      tenantId ??
      (await prisma.tenant
        .findUnique({ where: { rut: RUT }, select: { id: true } })
        .then((t) => t?.id)
        .catch(() => undefined));
    const usernames = [USUARIO_PLATAFORMA, ADMIN, COCINA, ADMIN_AGREGADO];
    if (id) usernames.push(`comensal-${id}`);
    for (const username of usernames) {
      await borrarUsuarioKeycloak(username).catch(() => undefined);
    }
    if (id) {
      await enTenant(id, async (tx) => {
        await tx.pedido.deleteMany({ where: { tenantId: id } });
        await tx.usuario.deleteMany({ where: { tenantId: id } });
        await tx.mesa.deleteMany({ where: { tenantId: id } });
        await tx.restaurante.deleteMany({ where: { tenantId: id } });
      }).catch(() => undefined);
      await prisma.tenant.deleteMany({ where: { id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdminSeed(
    '[TC-I-087] Plataforma: un token de establecimiento recibe 403 en todas las rutas de gestión',
    async () => {
      const token = await pedirToken(ADMIN_SEED, ADMIN_SEED_PASS as string);
      const ficha = `${RUTA}/${tenantId}`;
      // Funciones: cada pedido se arma recién cuando le toca (supertest
      // levanta el servidor al crear el pedido).
      const pedidos = [
        () => api().get(ficha),
        () => api().patch(ficha).send({ razonSocial: 'Intruso SRL' }),
        () => api().post(`${ficha}/suspender`).send({ motivo: 'Intruso' }),
        () => api().post(`${ficha}/reactivar`),
        () => api().post(`${ficha}/administradores`).send({}),
        () =>
          api().post(
            `${ficha}/administradores/${randomUUID()}/restablecer-contrasena`,
          ),
        () => api().delete(ficha).send({ rut: RUT }),
      ];
      for (const pedido of pedidos) {
        await pedido().set('Authorization', `Bearer ${token}`).expect(403);
      }

      // Nada cambió.
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      expect(tenant).toEqual(
        expect.objectContaining({ razonSocial: ALTA.razonSocial, rut: RUT }),
      );
    },
  );

  itConPlataforma(
    '[TC-I-088] Plataforma: el RUT tiene que tener el dígito verificador correcto (alta y edición, 400) y no puede ser de otro establecimiento (409)',
    async () => {
      const otroRut = rutDePrueba(String(Number(SUFIJO.slice(-6)) + 700_000));
      await comoPlataforma(api().post(RUTA))
        .send({ ...ALTA, rut: rutConVerificadorIncorrecto(otroRut) })
        .expect(400);
      expect(
        await prisma.tenant.count({
          where: { rut: rutConVerificadorIncorrecto(otroRut) },
        }),
      ).toBe(0);

      await comoPlataforma(api().patch(`${RUTA}/${tenantId}`))
        .send({ rut: rutConVerificadorIncorrecto(RUT) })
        .expect(400);

      // El RUT de cualquier otro establecimiento (el del seed, por ejemplo).
      const otro = await prisma.tenant.findFirst({
        where: { id: { not: tenantId } },
        select: { rut: true },
      });
      expect(otro).not.toBeNull();
      await comoPlataforma(api().patch(`${RUTA}/${tenantId}`))
        .send({ rut: otro?.rut })
        .expect(409);

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      expect(tenant?.rut).toBe(RUT);
    },
  );

  itConPlataforma(
    '[TC-I-089] Plataforma: la ficha y el listado muestran el establecimiento sin actividad como eliminable, sin contraseñas',
    async () => {
      const ficha = await comoPlataforma(
        api().get(`${RUTA}/${tenantId}`),
      ).expect(200);
      expect(ficha.body).toEqual(
        expect.objectContaining({
          tenantId,
          rut: RUT,
          estado: 'ACTIVO',
          eliminable: true,
          administradores: [
            expect.objectContaining({
              username: ADMIN,
              id: expect.any(String),
            }),
          ],
        }),
      );
      expect(JSON.stringify(ficha.body)).not.toMatch(/password/i);

      const listado = await comoPlataforma(
        api().get(RUTA).query({ q: RUT }),
      ).expect(200);
      expect(listado.body.items).toEqual([
        expect.objectContaining({ tenantId, eliminable: true }),
      ]);
    },
  );

  itConPlataforma(
    '[TC-I-090] Plataforma: suspender corta el acceso de Admin, Cocina y comensal (403) y el menú público; reactivar lo devuelve',
    async () => {
      const tokens = {
        ADMIN: await pedirToken(ADMIN, CLAVE_TEST),
        COCINA: await pedirToken(COCINA, CLAVE_TEST),
        COMENSAL: await pedirToken(
          `comensal-${tenantId}`,
          COMENSAL_PASS as string,
        ),
      };
      const menu = `/menu/tenant/${tenantId}/restaurante/${restauranteId}`;
      for (const token of Object.values(tokens)) {
        await api()
          .get('/test/mi-tenant')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }
      await api().get(menu).expect(200);

      const suspension = await comoPlataforma(
        api().post(`${RUTA}/${tenantId}/suspender`),
      )
        .send({ motivo: 'Prueba de integración' })
        .expect(200);
      expect(suspension.body).toEqual(
        expect.objectContaining({
          estado: 'SUSPENDIDO',
          suspension: expect.objectContaining({
            motivo: 'Prueba de integración',
          }),
        }),
      );

      // Los tokens emitidos antes de suspender dejan de servir.
      for (const [rol, token] of Object.entries(tokens)) {
        const res = await api()
          .get('/test/mi-tenant')
          .set('Authorization', `Bearer ${token}`);
        expect({ rol, status: res.status, codigo: res.body.codigo }).toEqual({
          rol,
          status: 403,
          codigo: 'ESTABLECIMIENTO_SUSPENDIDO',
        });
      }
      const menuSuspendido = await api().get(menu).expect(403);
      expect(menuSuspendido.body.codigo).toBe('ESTABLECIMIENTO_SUSPENDIDO');
      // El comensal no ve el motivo ni la palabra «suspendido».
      expect(JSON.stringify(menuSuspendido.body.message)).not.toMatch(
        /suspendid|Prueba de integración/i,
      );
      await api()
        .post('/auth/comensal')
        .send({ tenantId, restauranteId })
        .expect(403);

      await comoPlataforma(api().post(`${RUTA}/${tenantId}/reactivar`))
        .expect(200)
        .expect((res) => expect(res.body.estado).toBe('ACTIVO'));

      const tokenAdmin = await pedirToken(ADMIN, CLAVE_TEST);
      await api()
        .get('/test/mi-tenant')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      await api().get(menu).expect(200);
    },
  );

  itConAdminSeed(
    '[TC-I-091] Plataforma: restablecer la contraseña de un Administrador solo funciona dentro del establecimiento indicado (404 con el de otro)',
    async () => {
      // La fila del Admin del seed, que es de otro establecimiento.
      const tokenSeed = await pedirToken(ADMIN_SEED, ADMIN_SEED_PASS as string);
      const tenantSeed = claims(tokenSeed).tenant_id as string;
      const adminSeed = await enTenant(tenantSeed, (tx) =>
        tx.usuario.findFirst({
          where: { username: ADMIN_SEED },
          select: { id: true },
        }),
      );
      expect(adminSeed).not.toBeNull();

      await comoPlataforma(
        api().post(
          `${RUTA}/${tenantId}/administradores/${adminSeed?.id}/restablecer-contrasena`,
        ),
      ).expect(404);
      // Su contraseña no cambió.
      await pedirToken(ADMIN_SEED, ADMIN_SEED_PASS as string);

      // El Administrador propio, sí: contraseña temporal, una sola vez.
      const propio = await enTenant(tenantId, (tx) =>
        tx.usuario.findFirst({
          where: { tenantId, username: ADMIN },
          select: { id: true },
        }),
      );
      const res = await comoPlataforma(
        api().post(
          `${RUTA}/${tenantId}/administradores/${propio?.id}/restablecer-contrasena`,
        ),
      ).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(typeof res.body.temporaryPassword).toBe('string');
      // La contraseña definitiva del test ya no sirve.
      expect((await intentarToken(ADMIN, CLAVE_TEST)).ok).toBe(false);
    },
  );

  itConPlataforma(
    '[TC-I-092] Plataforma: agregar un Administrador lo crea solo en el establecimiento indicado (201) y da 404 en uno inexistente',
    async () => {
      const nuevo = {
        username: ADMIN_AGREGADO,
        email: `${ADMIN_AGREGADO}@prueba.bistrolink.local`,
        nombre: 'Laura',
        apellido: 'Gestion',
      };
      await comoPlataforma(
        api().post(`${RUTA}/${randomUUID()}/administradores`),
      )
        .send(nuevo)
        .expect(404);
      expect(await buscarUsuarioKeycloak(ADMIN_AGREGADO)).toBeUndefined();

      const res = await comoPlataforma(
        api().post(`${RUTA}/${tenantId}/administradores`),
      )
        .send(nuevo)
        .expect(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(typeof res.body.temporaryPassword).toBe('string');

      const fila = await enTenant(tenantId, (tx) =>
        tx.usuario.findFirst({ where: { username: ADMIN_AGREGADO } }),
      );
      expect(fila).toEqual(expect.objectContaining({ tenantId, rol: 'ADMIN' }));
      expect(await tenantIdEnKeycloak(ADMIN_AGREGADO)).toBe(tenantId);
    },
  );

  itConPlataforma(
    '[TC-I-093] Plataforma: eliminar un establecimiento con un pedido da 409 y con el RUT equivocado 400, sin borrar nada',
    async () => {
      await enTenant(tenantId, (tx) =>
        tx.pedido.create({
          data: {
            tenantId,
            restauranteId,
            mesaId: mesaVirtualId,
            idempotencyKey: `bl-416-${SUFIJO}`,
            estado: 'CANCELADO',
            canal: 'WEB',
          },
        }),
      );

      const ficha = await comoPlataforma(
        api().get(`${RUTA}/${tenantId}`),
      ).expect(200);
      expect(ficha.body.eliminable).toBe(false);

      const conActividad = await comoPlataforma(
        api().delete(`${RUTA}/${tenantId}`),
      )
        .send({ rut: RUT })
        .expect(409);
      expect(conActividad.body.message).toMatch(/suspendelo/);

      await comoPlataforma(api().delete(`${RUTA}/${tenantId}`))
        .send({ rut: rutConVerificadorIncorrecto(RUT) })
        .expect(400);

      // Sigue todo: tenant, restaurante, Admin y sus cuentas.
      expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
      const filas = await enTenant(tenantId, async (tx) => ({
        restaurantes: await tx.restaurante.count({ where: { tenantId } }),
        usuarios: await tx.usuario.count({ where: { tenantId } }),
      }));
      expect(filas.restaurantes).toBe(1);
      expect(filas.usuarios).toBeGreaterThan(0);
      expect(await buscarUsuarioKeycloak(COCINA)).toBeDefined();

      // Se saca el pedido para el próximo test.
      await enTenant(tenantId, (tx) =>
        tx.pedido.deleteMany({ where: { tenantId } }),
      );
    },
  );

  itConPlataforma(
    '[TC-I-094] Plataforma: eliminar un establecimiento sin actividad lo borra de la base y de Keycloak, y sus usuarios ya no ingresan',
    async () => {
      const res = await comoPlataforma(api().delete(`${RUTA}/${tenantId}`))
        .send({ rut: RUT })
        .expect(200);
      expect(res.body).toEqual({
        tenantId,
        datosEliminados: true,
        cuentas: { eliminadas: expect.any(Number), pendientes: [] },
      });
      // Admin, Admin agregado, Cocina y comensal.
      expect(res.body.cuentas.eliminadas).toBeGreaterThanOrEqual(4);

      expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(0);
      const filas = await enTenant(tenantId, async (tx) => ({
        restaurantes: await tx.restaurante.count({ where: { tenantId } }),
        usuarios: await tx.usuario.count({ where: { tenantId } }),
        mesas: await tx.mesa.count({ where: { tenantId } }),
      }));
      expect(filas).toEqual({ restaurantes: 0, usuarios: 0, mesas: 0 });

      for (const username of [
        ADMIN,
        COCINA,
        ADMIN_AGREGADO,
        `comensal-${tenantId}`,
      ]) {
        expect(await buscarUsuarioKeycloak(username)).toBeUndefined();
      }
      expect(
        (await intentarToken(`comensal-${tenantId}`, COMENSAL_PASS as string))
          .ok,
      ).toBe(false);

      // La ficha ya no existe y un reintento no encuentra nada que borrar.
      await comoPlataforma(api().get(`${RUTA}/${tenantId}`)).expect(404);
      await comoPlataforma(api().delete(`${RUTA}/${tenantId}`))
        .send({ rut: RUT })
        .expect(404);
    },
  );
});
