import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

/**
 * BL-163 (HU-027), entrega 2: POST /plataforma/establecimientos.
 *
 * Cubre el DoD de seguridad de la historia:
 * - Un token de ADMIN, COCINA o COMENSAL contra /plataforma/* → 403.
 * - Un token PLATAFORMA contra endpoints de tenant → 401.
 * - El alta crea el kit mínimo y el comensal técnico puede emitir su token.
 * - Reintentar el alta no duplica nada.
 * - El listado muestra el establecimiento nuevo y quién lo dio de alta.
 *
 * Setup: el realm tiene que tener el rol PLATAFORMA (keycloak/realm-export.json;
 * en un Keycloak ya levantado, crearlo a mano o reimportar el realm) y el
 * .env del backend, KEYCLOAK_COMENSAL_PASSWORD. El usuario PLATAFORMA del
 * test se crea y se borra acá, sin OTP: el OTP es del login en el navegador
 * y este test pide el token por password grant.
 *
 * Todo lo que crea (usuarios de Keycloak y filas de la base) se borra en
 * afterAll, aunque algún test falle.
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;
const COMENSAL_PASS = process.env.KEYCLOAK_COMENSAL_PASSWORD;

// Datos únicos por corrida: el RUT tiene que tener 12 dígitos.
const SUFIJO = Date.now().toString().slice(-10);
const RUT = `29${SUFIJO}`;
const USUARIO_PLATAFORMA = `dev-e2e${SUFIJO}-plataforma`;
const PASSWORD_PLATAFORMA = `Plataforma-${SUFIJO}`;
const ADMIN_NUEVO = `e2e-admin-${SUFIJO}`;
const COCINA_NUEVO = `e2e-cocina-${SUFIJO}`;

const ALTA = {
  razonSocial: `Restaurante e2e ${SUFIJO} SRL`,
  rut: RUT,
  restaurante: {
    nombre: `Restaurante e2e ${SUFIJO}`,
    direccion: 'Calle de Prueba 123',
  },
  admin: {
    username: ADMIN_NUEVO,
    email: `${ADMIN_NUEVO}@prueba.bistrolink.local`,
    nombre: 'Admin',
    apellido: 'Prueba',
  },
  cocina: { username: COCINA_NUEVO },
};

async function pedirToken(username: string, password: string) {
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
    throw new Error(
      `No se pudo obtener token para ${username}: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()).access_token as string;
}

function claims(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  );
}

// Mismo token de admin de master que usuarios.e2e-spec.ts.
async function getMasterAdminToken(): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username:
          process.env.KC_BOOTSTRAP_ADMIN_USERNAME ??
          process.env.KEYCLOAK_ADMIN ??
          'admin',
        password:
          process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ??
          process.env.KEYCLOAK_ADMIN_PASSWORD ??
          'admin',
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo obtener token de admin master: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

async function adminKeycloak(path: string, init: RequestInit = {}) {
  return fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getMasterAdminToken()}`,
      'Content-Type': 'application/json',
    },
  });
}

async function buscarUsuarioKeycloak(username: string) {
  const res = await adminKeycloak(
    `/users?username=${encodeURIComponent(username)}&exact=true`,
  );
  const usuarios = (await res.json()) as {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  }[];
  return usuarios[0];
}

async function rolesKeycloak(keycloakId: string): Promise<string[]> {
  const res = await adminKeycloak(`/users/${keycloakId}/role-mappings/realm`);
  return ((await res.json()) as { name: string }[]).map((r) => r.name);
}

async function borrarUsuarioKeycloak(username: string): Promise<void> {
  const usuario = await buscarUsuarioKeycloak(username);
  if (usuario) {
    await adminKeycloak(`/users/${usuario.id}`, { method: 'DELETE' });
  }
}

describe('Alta de establecimientos por la plataforma (HU-027) - e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tokenPlataforma: string;
  let tenantIdCreado: string | undefined;

  const itConPlataforma = COMENSAL_PASS ? it : it.skip;
  const itConAdmin = ADMIN_PASS ? it : it.skip;
  const itConCocina = COCINA_USER && COCINA_PASS ? it : it.skip;

  // Filas del tenant creado, leídas con su contexto (RLS).
  async function enTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

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

    // Usuario PLATAFORMA del test: sin tenant_id y sin OTP.
    const rol = await adminKeycloak('/roles/PLATAFORMA');
    if (!rol.ok) {
      throw new Error(
        'Falta el rol PLATAFORMA en el realm (ver keycloak/realm-export.json).',
      );
    }
    const creado = await adminKeycloak('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: USUARIO_PLATAFORMA,
        email: `${USUARIO_PLATAFORMA}@prueba.bistrolink.local`,
        firstName: 'Plataforma',
        lastName: 'Prueba',
        enabled: true,
        emailVerified: true,
        credentials: [
          { type: 'password', value: PASSWORD_PLATAFORMA, temporary: false },
        ],
      }),
    });
    if (creado.status !== 201) {
      throw new Error(
        `No se pudo crear el usuario PLATAFORMA del test: ${creado.status}`,
      );
    }
    const keycloakId = (creado.headers.get('location') as string)
      .split('/')
      .pop();
    await adminKeycloak(`/users/${keycloakId}/role-mappings/realm`, {
      method: 'POST',
      body: JSON.stringify([await rol.json()]),
    });
    tokenPlataforma = await pedirToken(USUARIO_PLATAFORMA, PASSWORD_PLATAFORMA);
  });

  afterAll(async () => {
    // Best-effort: cada paso por separado, para que uno que falle no corte
    // el resto de la limpieza.
    const usernames = [USUARIO_PLATAFORMA, ADMIN_NUEVO, COCINA_NUEVO];
    if (tenantIdCreado) usernames.push(`comensal-${tenantIdCreado}`);
    for (const username of usernames) {
      await borrarUsuarioKeycloak(username).catch(() => undefined);
    }
    if (tenantIdCreado) {
      const tenantId = tenantIdCreado;
      await enTenant(tenantId, async (tx) => {
        await tx.usuario.deleteMany({ where: { tenantId } });
        await tx.mesa.deleteMany({ where: { tenantId } });
        await tx.restaurante.deleteMany({ where: { tenantId } });
      }).catch(() => undefined);
      await prisma.tenant
        .deleteMany({ where: { id: tenantId } })
        .catch(() => undefined);
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('[TC-I-046] Plataforma: rechaza el alta sin token (401)', async () => {
    await request(app.getHttpServer())
      .post('/plataforma/establecimientos')
      .send(ALTA)
      .expect(401);
  });

  itConAdmin(
    '[TC-I-047] Plataforma: un ADMIN de un establecimiento no puede dar de alta otro (403)',
    async () => {
      const token = await pedirToken(ADMIN_USER, ADMIN_PASS as string);
      await request(app.getHttpServer())
        .post('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${token}`)
        .send(ALTA)
        .expect(403);
    },
  );

  itConCocina(
    '[TC-I-048] Plataforma: un usuario COCINA no puede dar de alta un establecimiento (403)',
    async () => {
      const token = await pedirToken(
        COCINA_USER as string,
        COCINA_PASS as string,
      );
      await request(app.getHttpServer())
        .post('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${token}`)
        .send(ALTA)
        .expect(403);
    },
  );

  itConPlataforma(
    '[TC-I-049] Plataforma: un token PLATAFORMA no sirve en los endpoints de un establecimiento (401)',
    async () => {
      for (const ruta of ['/test/mi-tenant', '/usuarios']) {
        await request(app.getHttpServer())
          .get(ruta)
          .set('Authorization', `Bearer ${tokenPlataforma}`)
          .expect(401);
      }
    },
  );

  itConPlataforma(
    '[TC-I-050] Plataforma: el alta crea el kit mínimo del establecimiento y el comensal técnico obtiene su token (201)',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${tokenPlataforma}`)
        .send(ALTA)
        .expect(201);
      tenantIdCreado = res.body.tenantId;
      const tenantId = res.body.tenantId as string;

      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual(
        expect.objectContaining({
          tenantCreado: true,
          restauranteCreado: true,
        }),
      );

      // Base: tenant, restaurante, mesa virtual y fila del Admin.
      const tenant = await prisma.tenant.findUnique({ where: { rut: RUT } });
      expect(tenant?.id).toBe(tenantId);
      // Quién dio el alta: el username del token, no un dato del body.
      expect(tenant?.creadoPor).toBe(USUARIO_PLATAFORMA);
      const filas = await enTenant(tenantId, async (tx) => ({
        restaurantes: await tx.restaurante.findMany({ where: { tenantId } }),
        mesas: await tx.mesa.findMany({ where: { tenantId } }),
        usuarios: await tx.usuario.findMany({ where: { tenantId } }),
      }));
      expect(filas.restaurantes).toHaveLength(1);
      expect(filas.mesas).toEqual([
        expect.objectContaining({ numero: 0, esVirtual: true }),
      ]);
      expect(filas.usuarios).toEqual([
        expect.objectContaining({ username: ADMIN_NUEVO, rol: 'ADMIN' }),
      ]);

      // Keycloak: los tres usuarios, con su rol y el perfil completo.
      const esperados: [string, string][] = [
        [ADMIN_NUEVO, 'ADMIN'],
        [COCINA_NUEVO, 'COCINA'],
        [`comensal-${tenantId}`, 'COMENSAL'],
      ];
      for (const [username, rol] of esperados) {
        const usuario = await buscarUsuarioKeycloak(username);
        expect(usuario).toBeDefined();
        expect(
          usuario.email && usuario.firstName && usuario.lastName,
        ).toBeTruthy();
        expect(await rolesKeycloak(usuario.id)).toContain(rol);
      }

      // Admin y Cocina: contraseña temporal, devuelta una sola vez.
      const conPassword = (
        res.body.usuarios as { rol: string; passwordGenerada?: string }[]
      )
        .filter((u) => u.passwordGenerada)
        .map((u) => u.rol);
      expect(conPassword.sort()).toEqual(['ADMIN', 'COCINA']);

      // El comensal técnico emite su token (sin VERIFY_PROFILE pendiente) y
      // el token es del tenant nuevo.
      const tokenComensal = await pedirToken(
        `comensal-${tenantId}`,
        COMENSAL_PASS as string,
      );
      expect(claims(tokenComensal).tenant_id).toBe(tenantId);
    },
  );

  itConPlataforma(
    '[TC-I-051] Plataforma: reintentar el alta no duplica nada ni genera contraseñas nuevas',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${tokenPlataforma}`)
        .send(ALTA)
        .expect(201);

      expect(res.body.tenantId).toBe(tenantIdCreado);
      expect(res.body).toEqual(
        expect.objectContaining({
          tenantCreado: false,
          restauranteCreado: false,
        }),
      );
      for (const u of res.body.usuarios as {
        creado: boolean;
        passwordGenerada?: string;
      }[]) {
        expect(u.creado).toBe(false);
        expect(u.passwordGenerada).toBeUndefined();
      }
      const tenantId = tenantIdCreado as string;
      const mesas = await enTenant(tenantId, (tx) =>
        tx.mesa.count({ where: { tenantId } }),
      );
      expect(mesas).toBe(1);
    },
  );

  itConPlataforma(
    '[TC-I-053] Plataforma: el listado muestra el establecimiento nuevo, su restaurante y quién lo dio de alta (200)',
    async () => {
      const res = await request(app.getHttpServer())
        .get('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${tokenPlataforma}`)
        .expect(200);

      // El alta más reciente va primero.
      expect(res.body.pagina).toBe(1);
      expect(res.body.items[0]).toEqual(
        expect.objectContaining({
          tenantId: tenantIdCreado,
          rut: RUT,
          creadoPor: USUARIO_PLATAFORMA,
          restaurante: expect.objectContaining({
            nombre: ALTA.restaurante.nombre,
          }),
        }),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    },
  );

  itConAdmin(
    '[TC-I-054] Plataforma: un ADMIN de un establecimiento no puede ver el listado de establecimientos (403)',
    async () => {
      const token = await pedirToken(ADMIN_USER, ADMIN_PASS as string);
      await request(app.getHttpServer())
        .get('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    },
  );

  itConPlataforma(
    '[TC-I-052] Plataforma: el comensal técnico del establecimiento nuevo no puede dar de alta otro (403)',
    async () => {
      const tokenComensal = await pedirToken(
        `comensal-${tenantIdCreado}`,
        COMENSAL_PASS as string,
      );
      await request(app.getHttpServer())
        .post('/plataforma/establecimientos')
        .set('Authorization', `Bearer ${tokenComensal}`)
        .send(ALTA)
        .expect(403);
    },
  );
});
