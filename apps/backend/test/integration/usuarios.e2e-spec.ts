import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;

const RESTAURANTE_TENANT_A = '87152395-a721-4651-99b8-f21075d1d8ae';
const RESTAURANTE_TENANT_B = 'a46faef3-7412-45ae-af80-3829cd27b990';

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
    throw new Error(
      `No se pudo obtener token para ${username}: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  return data.access_token as string;
}

// Token de admin de MASTER (no del realm bistrolink) para poder borrar
// usuarios via Admin REST API directo. Usa las mismas credenciales de admin
// de Keycloak que ya usan set-client-secret.sh y setup-service-account.sh.
async function getMasterAdminToken(): Promise<string> {
  const adminUser =
    process.env.KC_BOOTSTRAP_ADMIN_USERNAME ??
    process.env.KEYCLOAK_ADMIN ??
    'admin';
  const adminPass =
    process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ??
    process.env.KEYCLOAK_ADMIN_PASSWORD ??
    'admin';
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: adminUser,
        password: adminPass,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`No se pudo obtener token de admin master: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

// Borra un usuario de Keycloak por su id interno.
async function borrarUsuarioKeycloak(keycloakId: string): Promise<void> {
  const adminToken = await getMasterAdminToken();
  await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  // No chequeamos el status a proposito: si el usuario ya no existe (un
  // test previo lo borro, o fallo antes de crearlo), un 404 aca no deberia
  // hacer fallar el cleanup del resto de la suite.
}

describe('Gestión de usuarios (HU-013) - e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  // Junta los ids de Keycloak de todos los usuarios creados en esta corrida,
  // para borrarlos al final de los DOS lados (Keycloak y Postgres) - evita
  // que se acumulen usuarios de test tipo "mozo-test-<timestamp>" tanto en
  // el realm como en la tabla `usuario`, aunque ambos queden desincronizados
  // entre si (por ejemplo si Keycloak se resetea pero la base no).
  const usuariosCreados: string[] = [];

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    // Cleanup: borra cada usuario que se llego a crear durante la corrida,
    // sin importar si algun test individual fallo. Se borra primero de
    // Keycloak y despues de Postgres (por keycloakId), cada uno best-effort
    // e independiente del otro, para que un 404 de un lado no impida
    // limpiar el otro.
    for (const keycloakId of usuariosCreados) {
      await borrarUsuarioKeycloak(keycloakId).catch(() => {
        // Best-effort: un fallo aca no debe ocultar el resultado real de
        // los tests ni cortar el resto del cleanup.
      });
      await prisma.usuario.deleteMany({ where: { keycloakId } }).catch(() => {
        // Idem: best-effort, no debe cortar el resto del cleanup.
      });
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-006] Usuarios: ADMIN puede crear un Mozo en su propio restaurante (201)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: `mozo-test-${Date.now()}`,
          email: `mozo-test-${Date.now()}@bistrolink.dev`,
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);

      expect(res.body.rol).toBe('MOZO');
      expect(res.body.restauranteId).toBe(RESTAURANTE_TENANT_A);
      expect(res.body.temporaryPassword).toBeDefined();
      expect(res.body.keycloakId).toBeDefined();

      // Registra el usuario creado para borrarlo (Keycloak + Postgres) en
      // afterAll.
      usuariosCreados.push(res.body.keycloakId);
    },
  );

  itConAdmin(
    '[TC-I-007] Usuarios: rechaza crear usuario en restaurante de otro tenant (403)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: `intento-cruzado-${Date.now()}`,
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_B,
        })
        .expect(403);
      // Este caso no llega a crear nada (rechazado antes) - no hay nada que
      // agregar a usuariosCreados aca.
    },
  );

  it('[TC-I-008] Usuarios: rechaza request sin token (401)', async () => {
    await request(app.getHttpServer())
      .post('/usuarios')
      .send({
        username: 'sin-auth-test',
        rol: 'MOZO',
        restauranteId: RESTAURANTE_TENANT_A,
      })
      .expect(401);
  });
});

// ── BL-265 (BL-262, hallazgo R16): aislamiento de PATCH y DELETE ───────────
// Hasta acá solo la creación tenía test de aislamiento (TC-I-007). Estos dos
// casos verifican que un ADMIN del tenant A no puede cambiar el rol ni
// desactivar a un usuario del tenant B conociendo su id: el servicio busca
// el usuario en Postgres bajo RLS (runInTenantContext con el tenant del
// token), no lo encuentra y responde 404 sin tocar Keycloak.
describe('Gestión de usuarios (HU-013) - aislamiento de PATCH y DELETE (BL-265)', () => {
  const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';

  let app: INestApplication;
  let prisma: PrismaClient;
  let keycloakIdB: string | undefined;
  let usuarioIdB: string | undefined;

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  // Lee la fila del usuario de B con el contexto de tenant B (RLS).
  async function filaUsuarioB() {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
      return tx.usuario.findUnique({ where: { id: usuarioIdB } });
    });
  }

  // Estado del usuario de B en Keycloak: habilitado y roles de realm.
  async function estadoKeycloakB() {
    const headers = {
      Authorization: `Bearer ${await getMasterAdminToken()}`,
    };
    const base = `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakIdB}`;
    const usuario = await (await fetch(base, { headers })).json();
    const roles = await (
      await fetch(`${base}/role-mappings/realm`, { headers })
    ).json();
    return {
      enabled: usuario.enabled as boolean,
      roles: (roles as { name: string }[]).map((r) => r.name),
    };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();

    // Usuario MOZO del tenant B, creado como lo haría /usuarios: en Keycloak
    // (con tenant_id = B y rol MOZO) y con su fila en `usuario`.
    const adminToken = await getMasterAdminToken();
    const headers = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    };
    const username = `mozo-b-r16-${Date.now()}`;
    const creado = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username,
        email: `${username}@bistrolink.dev.com`,
        firstName: 'Mozo',
        lastName: 'TenantB',
        enabled: true,
        attributes: { tenant_id: [TENANT_B] },
      }),
    });
    if (creado.status !== 201) {
      throw new Error(`No se pudo crear el usuario de B: ${creado.status}`);
    }
    keycloakIdB = (creado.headers.get('location') as string).split('/').pop();

    const rolMozo = await (
      await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/roles/MOZO`, {
        headers,
      })
    ).json();
    await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakIdB}/role-mappings/realm`,
      { method: 'POST', headers, body: JSON.stringify([rolMozo]) },
    );

    const fila = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
      return tx.usuario.create({
        data: {
          tenantId: TENANT_B,
          restauranteId: RESTAURANTE_TENANT_B,
          keycloakId: keycloakIdB as string,
          username,
          email: `${username}@bistrolink.dev.com`,
          rol: 'MOZO',
          activo: true,
        },
      });
    });
    usuarioIdB = fila.id;
  });

  afterAll(async () => {
    if (keycloakIdB) {
      await borrarUsuarioKeycloak(keycloakIdB).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId: keycloakIdB } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-041] Usuarios: ADMIN no puede cambiar el rol de un usuario de otro tenant (404)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .patch(`/usuarios/${usuarioIdB}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ rol: 'ADMIN' })
        .expect(404);

      // Sin cambios en Postgres ni en Keycloak.
      const fila = await filaUsuarioB();
      expect(fila?.rol).toBe('MOZO');
      expect(fila?.activo).toBe(true);
      const kc = await estadoKeycloakB();
      expect(kc.roles).toContain('MOZO');
      expect(kc.roles).not.toContain('ADMIN');
    },
  );

  itConAdmin(
    '[TC-I-042] Usuarios: ADMIN no puede desactivar a un usuario de otro tenant (404)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .delete(`/usuarios/${usuarioIdB}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Sigue activo en Postgres y habilitado en Keycloak.
      const fila = await filaUsuarioB();
      expect(fila?.activo).toBe(true);
      expect((await estadoKeycloakB()).enabled).toBe(true);
    },
  );
});
