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

// Restaurante del tenant de testing A, donde está admin-test (BL-197).
const RESTAURANTE_TENANT_A = '22222222-2222-2222-2222-222222222222';
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
          nombre: 'Mozo',
          apellido: 'Prueba',
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
          nombre: 'Mozo',
          apellido: 'Prueba',
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
        nombre: 'Mozo',
        apellido: 'Prueba',
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

  itConAdmin(
    '[TC-I-058] Usuarios: ADMIN no puede reactivar a un usuario de otro tenant (404) (BL-358)',
    async () => {
      // Se desactiva al usuario de B directo en Postgres y en Keycloak (no
      // por la API, que lo rechazaría por ser de otro tenant), para que
      // una reactivación cruzada tuviera algo que cambiar.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
        await tx.usuario.update({
          where: { id: usuarioIdB },
          data: { activo: false },
        });
      });
      await fetch(
        `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakIdB}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${await getMasterAdminToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enabled: false }),
        },
      );

      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .patch(`/usuarios/${usuarioIdB}/activar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Sigue desactivado de los dos lados.
      const fila = await filaUsuarioB();
      expect(fila?.activo).toBe(false);
      expect((await estadoKeycloakB()).enabled).toBe(false);
    },
  );

  itConAdmin(
    '[TC-I-060] Usuarios: ADMIN no puede restablecer la contraseña de un usuario de otro tenant (404) (BL-359)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .post(`/usuarios/${usuarioIdB}/restablecer-contrasena`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.temporaryPassword).toBeUndefined();

      // El usuario de B se creó sin contraseña: sigue sin ninguna.
      const credenciales = await (
        await fetch(
          `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakIdB}/credentials`,
          {
            headers: { Authorization: `Bearer ${await getMasterAdminToken()}` },
          },
        )
      ).json();
      expect(credenciales).toEqual([]);
    },
  );
});

// ── BL-272 (BL-262): al desactivar se cierran las sesiones de Keycloak ──────
// setEnabled(false) solo impedía los logins nuevos: la sesión abierta seguía
// viva en Keycloak y, si la cuenta se volvía a activar, el refresh token
// viejo volvía a servir. Ahora DELETE /usuarios/:id también llama a
// POST /users/{id}/logout. Este caso abre una sesión real, desactiva al
// usuario por la API y verifica en Keycloak que la sesión ya no existe.
describe('Gestión de usuarios (HU-013) - cierre de sesiones al desactivar (BL-272)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let creado: { id: string; keycloakId: string; tenantId: string } | undefined;

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  const adminHeaders = async () => ({
    Authorization: `Bearer ${await getMasterAdminToken()}`,
    'Content-Type': 'application/json',
  });

  // Sesiones activas del usuario en Keycloak.
  async function sesionesKeycloak(keycloakId: string): Promise<number> {
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}/sessions`,
      { headers: await adminHeaders() },
    );
    return ((await res.json()) as unknown[]).length;
  }

  // Pedido de token al endpoint del realm (password o refresh_token).
  async function pedirToken(params: Record<string, string>) {
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          ...params,
        }),
      },
    );
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    if (creado) {
      const { keycloakId, tenantId } = creado;
      await borrarUsuarioKeycloak(keycloakId).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-045] Usuarios: al desactivar un usuario se cierran sus sesiones de Keycloak y su refresh token deja de servir',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const username = `mozo-sesion-${Date.now()}`;

      // 1. Alta por la API, como desde Admin → Usuarios.
      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          username,
          email: `${username}@bistrolink.dev`,
          nombre: 'Mozo',
          apellido: 'Prueba',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);
      creado = {
        id: res.body.id,
        keycloakId: res.body.keycloakId,
        tenantId: res.body.tenantId,
      };
      const { keycloakId } = creado;

      // 2. La contraseña de /usuarios es temporal y el perfil pide nombre y
      //    apellido: el password grant responde «Account is not fully set
      //    up». Se completan por la Admin API para poder abrir sesión.
      const password = `Sesion-${Date.now()}`;
      const base = `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`;
      await fetch(base, {
        method: 'PUT',
        headers: await adminHeaders(),
        body: JSON.stringify({ firstName: 'Mozo', lastName: 'Sesion' }),
      });
      await fetch(`${base}/reset-password`, {
        method: 'PUT',
        headers: await adminHeaders(),
        body: JSON.stringify({
          type: 'password',
          value: password,
          temporary: false,
        }),
      });

      // 3. El mozo inicia sesión.
      const login = await pedirToken({
        grant_type: 'password',
        username,
        password,
      });
      expect(login.status).toBe(200);
      expect(await sesionesKeycloak(keycloakId)).toBe(1);

      // 4. El admin lo desactiva.
      await request(app.getHttpServer())
        .delete(`/usuarios/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      // 5. No le queda ninguna sesión en Keycloak.
      expect(await sesionesKeycloak(keycloakId)).toBe(0);

      // 6. Su refresh token ya no sirve. «Session not active» indica que la
      //    sesión se cerró; solo desactivando, Keycloak respondía «User
      //    disabled» y el token volvía a servir al reactivar la cuenta.
      const refresh = await pedirToken({
        grant_type: 'refresh_token',
        refresh_token: login.body.refresh_token,
      });
      expect(refresh.status).toBe(400);
      expect(refresh.body.error).toBe('invalid_grant');
      expect(refresh.body.error_description).toBe('Session not active');
    },
  );
});

// ── BL-358: reactivar un usuario desactivado ────────────────────────────────
// PATCH /usuarios/:id/activar vuelve a habilitar al usuario en Keycloak y
// marca `activo: true` en Postgres. El caso cruzado (otro tenant → 404) está
// en el bloque de BL-265 (TC-I-058).
describe('Gestión de usuarios (HU-013) - reactivar (BL-358)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let creado: { id: string; keycloakId: string; tenantId: string } | undefined;

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  async function habilitadoEnKeycloak(keycloakId: string): Promise<boolean> {
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`,
      { headers: { Authorization: `Bearer ${await getMasterAdminToken()}` } },
    );
    return ((await res.json()) as { enabled: boolean }).enabled;
  }

  async function filaUsuario(id: string, tenantId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return tx.usuario.findUnique({ where: { id } });
    });
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    if (creado) {
      const { keycloakId, tenantId } = creado;
      await borrarUsuarioKeycloak(keycloakId).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-057] Usuarios: ADMIN reactiva a un usuario desactivado de su tenant (200)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const username = `mozo-reactivar-${Date.now()}`;

      // 1. Alta y baja por la API, como desde Admin → Usuarios.
      const alta = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username,
          email: `${username}@bistrolink.dev`,
          nombre: 'Mozo',
          apellido: 'Prueba',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);
      creado = {
        id: alta.body.id,
        keycloakId: alta.body.keycloakId,
        tenantId: alta.body.tenantId,
      };
      const { id, keycloakId, tenantId } = creado;

      await request(app.getHttpServer())
        .delete(`/usuarios/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(await habilitadoEnKeycloak(keycloakId)).toBe(false);

      // 2. Reactivación.
      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${id}/activar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual({ activo: true, id });

      // 3. Activo de los dos lados: puede volver a ingresar.
      expect((await filaUsuario(id, tenantId))?.activo).toBe(true);
      expect(await habilitadoEnKeycloak(keycloakId)).toBe(true);

      // 4. Repetir la reactivación no falla (doble clic, otra pestaña).
      await request(app.getHttpServer())
        .patch(`/usuarios/${id}/activar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    },
  );
});

// ── BL-359: restablecer la contraseña de un usuario (admin) ─────────────────
// POST /usuarios/:id/restablecer-contrasena reemplaza la contraseña por una
// temporal nueva y cierra las sesiones del usuario. El caso cruzado (otro
// tenant → 404) está en el bloque de BL-265 (TC-I-060).
describe('Gestión de usuarios (HU-013) - restablecer contraseña (BL-359)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let creado: { id: string; keycloakId: string; tenantId: string } | undefined;

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  const adminHeaders = async () => ({
    Authorization: `Bearer ${await getMasterAdminToken()}`,
    'Content-Type': 'application/json',
  });

  async function sesionesKeycloak(keycloakId: string): Promise<number> {
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}/sessions`,
      { headers: await adminHeaders() },
    );
    return ((await res.json()) as unknown[]).length;
  }

  async function login(username: string, password: string) {
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
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    if (creado) {
      const { keycloakId, tenantId } = creado;
      await borrarUsuarioKeycloak(keycloakId).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-059] Usuarios: ADMIN restablece la contraseña: la vieja deja de servir, se cierran las sesiones y la temporal pide cambiarla',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const username = `mozo-restablecer-${Date.now()}`;

      // 1. Alta por la API y contraseña definitiva por la Admin API, para
      //    poder abrir una sesión (mismo armado que TC-I-045).
      const alta = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          username,
          email: `${username}@bistrolink.dev`,
          nombre: 'Mozo',
          apellido: 'Prueba',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);
      creado = {
        id: alta.body.id,
        keycloakId: alta.body.keycloakId,
        tenantId: alta.body.tenantId,
      };
      const { id, keycloakId } = creado;

      const passwordVieja = `Vieja-${Date.now()}`;
      const base = `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`;
      await fetch(base, {
        method: 'PUT',
        headers: await adminHeaders(),
        body: JSON.stringify({ firstName: 'Mozo', lastName: 'Restablecer' }),
      });
      await fetch(`${base}/reset-password`, {
        method: 'PUT',
        headers: await adminHeaders(),
        body: JSON.stringify({
          type: 'password',
          value: passwordVieja,
          temporary: false,
        }),
      });

      // 2. El mozo inicia sesión.
      expect((await login(username, passwordVieja)).status).toBe(200);
      expect(await sesionesKeycloak(keycloakId)).toBe(1);

      // 3. El admin restablece la contraseña.
      const res = await request(app.getHttpServer())
        .post(`/usuarios/${id}/restablecer-contrasena`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.id).toBe(id);
      expect(res.body.sesionesCerradas).toBe(true);
      const temporal = res.body.temporaryPassword as string;
      expect(temporal).toHaveLength(16);

      // 4. No le quedan sesiones abiertas.
      expect(await sesionesKeycloak(keycloakId)).toBe(0);

      // 5. La contraseña vieja ya no sirve. Keycloak 26 responde 400 (no
      //    401) a credenciales inválidas en el password grant; lo que
      //    distingue el caso es el error_description.
      const conVieja = await login(username, passwordVieja);
      expect(conVieja.status).toBe(400);
      expect(conVieja.body.error).toBe('invalid_grant');
      expect(conVieja.body.error_description).toBe('Invalid user credentials');

      // 6. La temporal es correcta, pero Keycloak exige cambiarla antes de
      //    entrar: responde «Account is not fully set up» (y no «Invalid
      //    user credentials») y el usuario queda con UPDATE_PASSWORD.
      const conTemporal = await login(username, temporal);
      expect(conTemporal.status).toBe(400);
      expect(conTemporal.body.error_description).toBe(
        'Account is not fully set up',
      );
      const usuarioKc = await (
        await fetch(base, { headers: await adminHeaders() })
      ).json();
      expect(usuarioKc.requiredActions).toContain('UPDATE_PASSWORD');
    },
  );

  itConAdmin(
    '[TC-I-061] Usuarios: no se puede restablecer la contraseña de un usuario desactivado (409)',
    async () => {
      // Usa el usuario de TC-I-059: se lo desactiva por la API.
      if (!creado) throw new Error('TC-I-059 no llegó a crear el usuario');
      const tokenAdmin = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .delete(`/usuarios/${creado.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .post(`/usuarios/${creado.id}/restablecer-contrasena`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(409);
      expect(res.body.temporaryPassword).toBeUndefined();
    },
  );
});

// ── BL-361: nombre y apellido en el alta ────────────────────────────────────
describe('Gestión de usuarios (HU-013) - nombre y apellido (BL-361)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let creado: { id: string; keycloakId: string; tenantId: string } | undefined;

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
    if (creado) {
      const { keycloakId, tenantId } = creado;
      await borrarUsuarioKeycloak(keycloakId).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-062] Usuarios: el alta guarda nombre y apellido en Keycloak y en la fila, y el listado los devuelve',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const username = `mozo-nombre-${Date.now()}`;

      const alta = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username,
          email: `${username}@bistrolink.dev`,
          nombre: 'María José',
          apellido: 'Pérez-Núñez',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);
      creado = {
        id: alta.body.id,
        keycloakId: alta.body.keycloakId,
        tenantId: alta.body.tenantId,
      };
      expect(alta.body.nombre).toBe('María José');
      expect(alta.body.apellido).toBe('Pérez-Núñez');

      // En Keycloak: firstName y lastName (los lee el encabezado, BL-350).
      const usuarioKc = await (
        await fetch(
          `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${creado.keycloakId}`,
          {
            headers: { Authorization: `Bearer ${await getMasterAdminToken()}` },
          },
        )
      ).json();
      expect(usuarioKc.firstName).toBe('María José');
      expect(usuarioKc.lastName).toBe('Pérez-Núñez');

      // En el listado.
      const lista = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const fila = (
        lista.body as { id: string; nombre: string; apellido: string }[]
      ).find((u) => u.id === creado?.id);
      expect(fila).toMatchObject({
        nombre: 'María José',
        apellido: 'Pérez-Núñez',
      });
    },
  );
});

// ── BL-362: cuenta de cocina en el listado ──────────────────────────────────
// La cuenta de cocina vive solo en Keycloak (sin fila en `usuario`). Se lista
// desde Keycloak y sus acciones van por /usuarios/cocina/:keycloakId. Los
// casos que la modifican usan una cuenta de cocina temporal, creada acá,
// para no tocar la de prueba del tenant A, que usan la KDS y los E2E.
describe('Gestión de usuarios (HU-013) - cuenta de cocina (BL-362)', () => {
  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const COCINA_A_USERNAME = process.env.TEST_COCINA_USERNAME ?? 'cocina-test';
  const COCINA_B_KEYCLOAK_ID = '0fd5421a-a1f4-4fe4-ab95-8a3482a3e5cd'; // test-users.json

  let app: INestApplication;
  let cocinaTemporalId: string | undefined;

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  const adminHeaders = async () => ({
    Authorization: `Bearer ${await getMasterAdminToken()}`,
    'Content-Type': 'application/json',
  });

  async function usuarioKeycloak(keycloakId: string) {
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`,
      { headers: await adminHeaders() },
    );
    return (await res.json()) as {
      enabled: boolean;
      requiredActions?: string[];
    };
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // Cuenta de cocina temporal del tenant A, armada como la crea el alta de
    // establecimiento (BL-163): tenant_id, rol COCINA y perfil completo.
    const username = `cocina-temporal-${Date.now()}`;
    const headers = await adminHeaders();
    const creado = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username,
        email: `${username}@tecnico.bistrolink.local`,
        firstName: 'Cocina',
        lastName: 'BistroLink',
        enabled: true,
        attributes: { tenant_id: [TENANT_A] },
      }),
    });
    if (creado.status !== 201) {
      throw new Error(
        `No se pudo crear la cuenta de cocina temporal: ${creado.status}`,
      );
    }
    cocinaTemporalId = (creado.headers.get('location') as string)
      .split('/')
      .pop();
    const rolCocina = await (
      await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/roles/COCINA`, {
        headers,
      })
    ).json();
    await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${cocinaTemporalId}/role-mappings/realm`,
      { method: 'POST', headers, body: JSON.stringify([rolCocina]) },
    );
  });

  afterAll(async () => {
    if (cocinaTemporalId) {
      await borrarUsuarioKeycloak(cocinaTemporalId).catch(() => undefined);
    }
    await app.close();
  });

  itConAdmin(
    '[TC-I-063] Usuarios: el listado del tenant A incluye su cuenta de cocina como cuenta compartida, y no la del tenant B',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .get('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lista = res.body as {
        keycloakId: string;
        username: string;
        rol: string;
        cuentaCompartida: boolean;
      }[];

      expect(lista).toContainEqual(
        expect.objectContaining({
          username: COCINA_A_USERNAME,
          rol: 'COCINA',
          cuentaCompartida: true,
        }),
      );
      expect(lista.map((u) => u.keycloakId)).not.toContain(
        COCINA_B_KEYCLOAK_ID,
      );
      // El personal (filas de `usuario`) sigue marcado como no compartido.
      expect(
        lista
          .filter((u) => u.rol !== 'COCINA')
          .every((u) => !u.cuentaCompartida),
      ).toBe(true);
    },
  );

  itConAdmin(
    '[TC-I-064] Usuarios: ADMIN desactiva, reactiva y restablece la contraseña de la cuenta de cocina de su tenant',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const ruta = `/usuarios/cocina/${cocinaTemporalId}`;

      await request(app.getHttpServer())
        .delete(ruta)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((await usuarioKeycloak(cocinaTemporalId as string)).enabled).toBe(
        false,
      );

      await request(app.getHttpServer())
        .patch(`${ruta}/activar`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect((await usuarioKeycloak(cocinaTemporalId as string)).enabled).toBe(
        true,
      );

      const res = await request(app.getHttpServer())
        .post(`${ruta}/restablecer-contrasena`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.temporaryPassword).toHaveLength(16);
      expect(
        (await usuarioKeycloak(cocinaTemporalId as string)).requiredActions,
      ).toContain('UPDATE_PASSWORD');
    },
  );

  itConAdmin(
    '[TC-I-065] Usuarios: ADMIN no puede tocar la cuenta de cocina de otro tenant (404)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const ruta = `/usuarios/cocina/${COCINA_B_KEYCLOAK_ID}`;
      const antes = await usuarioKeycloak(COCINA_B_KEYCLOAK_ID);

      await request(app.getHttpServer())
        .post(`${ruta}/restablecer-contrasena`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(ruta)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // Sin cambios en la cuenta de cocina del tenant B.
      const despues = await usuarioKeycloak(COCINA_B_KEYCLOAK_ID);
      expect(despues.enabled).toBe(antes.enabled);
      expect(despues.requiredActions ?? []).toEqual(
        antes.requiredActions ?? [],
      );
    },
  );
});

// ── BL-366: editar nombre, apellido y correo ────────────────────────────────
describe('Gestión de usuarios (HU-013) - editar datos (BL-366)', () => {
  const COCINA_A_KEYCLOAK_ID = 'd1a2b3c4-5566-4778-8899-aabbccddeeff'; // test-users.json

  let app: INestApplication;
  let prisma: PrismaClient;
  let creado: { id: string; keycloakId: string; tenantId: string } | undefined;

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
    if (creado) {
      const { keycloakId, tenantId } = creado;
      await borrarUsuarioKeycloak(keycloakId).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-066] Usuarios: ADMIN cambia el nombre y el correo de un usuario, en Keycloak y en el listado',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const username = `mozo-editar-${Date.now()}`;

      const alta = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username,
          email: `${username}@bistrolink.dev`,
          nombre: 'Mozo',
          apellido: 'Prueba',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);
      creado = {
        id: alta.body.id,
        keycloakId: alta.body.keycloakId,
        tenantId: alta.body.tenantId,
      };

      const nuevoEmail = `${username}-nuevo@bistrolink.dev`;
      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${creado.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: 'Juan Carlos', email: nuevoEmail })
        .expect(200);
      expect(res.body).toMatchObject({
        nombre: 'Juan Carlos',
        apellido: 'Prueba',
        email: nuevoEmail,
        rol: 'MOZO',
      });

      // En Keycloak (lo lee el encabezado en el próximo ingreso).
      const usuarioKc = await (
        await fetch(
          `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${creado.keycloakId}`,
          {
            headers: { Authorization: `Bearer ${await getMasterAdminToken()}` },
          },
        )
      ).json();
      expect(usuarioKc.firstName).toBe('Juan Carlos');
      expect(usuarioKc.lastName).toBe('Prueba');
      expect(usuarioKc.email).toBe(nuevoEmail);
      // Se reenvía el usuario entero: el tenant_id sigue ahí.
      expect(usuarioKc.attributes?.tenant_id).toEqual([creado.tenantId]);
    },
  );

  itConAdmin(
    '[TC-I-067] Usuarios: un correo que ya usa otra persona se rechaza con 409 y no cambia nada',
    async () => {
      if (!creado) throw new Error('TC-I-066 no llegó a crear el usuario');
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .patch(`/usuarios/${creado.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'admin-test@bistrolink.dev.com' })
        .expect(409);
      expect(res.body.message).toBe('Ya hay otro usuario con ese correo');

      const fila = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${creado?.tenantId}, true)`;
        return tx.usuario.findUnique({ where: { id: creado?.id } });
      });
      expect(fila?.email).not.toBe('admin-test@bistrolink.dev.com');
    },
  );

  itConAdmin(
    '[TC-I-068] Usuarios: la cuenta de cocina no se edita por PATCH /usuarios/:id (404)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .patch(`/usuarios/${COCINA_A_KEYCLOAK_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: 'Otra' })
        .expect(404);
    },
  );
});

// ── BL-367: cerrar las sesiones de un usuario ───────────────────────────────
describe('Gestión de usuarios (HU-013) - cerrar sesiones (BL-367)', () => {
  const COCINA_B_KEYCLOAK_ID = '0fd5421a-a1f4-4fe4-ab95-8a3482a3e5cd'; // test-users.json

  let app: INestApplication;
  let prisma: PrismaClient;
  let creado: { id: string; keycloakId: string; tenantId: string } | undefined;

  const itConAdmin = ADMIN_PASS ? it : it.skip;

  const adminHeaders = async () => ({
    Authorization: `Bearer ${await getMasterAdminToken()}`,
    'Content-Type': 'application/json',
  });

  async function pedirToken(params: Record<string, string>) {
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          ...params,
        }),
      },
    );
    return { status: res.status, body: await res.json() };
  }

  async function sesionesKeycloak(keycloakId: string): Promise<number> {
    const res = await fetch(
      `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}/sessions`,
      { headers: await adminHeaders() },
    );
    return ((await res.json()) as unknown[]).length;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    if (creado) {
      const { keycloakId, tenantId } = creado;
      await borrarUsuarioKeycloak(keycloakId).catch(() => undefined);
      await prisma
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          await tx.usuario.deleteMany({ where: { keycloakId } });
        })
        .catch(() => undefined); // best-effort
    }
    await prisma.$disconnect();
    await app.close();
  });

  itConAdmin(
    '[TC-I-069] Usuarios: ADMIN cierra las sesiones de un usuario, que queda sin sesiones y sigue activo',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER, ADMIN_PASS as string);
      const username = `mozo-sesiones-${Date.now()}`;

      const alta = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          username,
          email: `${username}@bistrolink.dev`,
          nombre: 'Mozo',
          apellido: 'Sesiones',
          rol: 'MOZO',
          restauranteId: RESTAURANTE_TENANT_A,
        })
        .expect(201);
      creado = {
        id: alta.body.id,
        keycloakId: alta.body.keycloakId,
        tenantId: alta.body.tenantId,
      };
      const { id, keycloakId } = creado;

      // Contraseña definitiva para poder abrir una sesión (como TC-I-045; el
      // nombre y el apellido ya vienen del alta desde BL-361).
      const base = `${KEYCLOAK_URL}/admin/realms/${REALM}/users/${keycloakId}`;
      const contrasena = `Sesiones-${Date.now()}`;
      await fetch(`${base}/reset-password`, {
        method: 'PUT',
        headers: await adminHeaders(),
        body: JSON.stringify({
          type: 'password',
          value: contrasena,
          temporary: false,
        }),
      });
      const login = await pedirToken({
        grant_type: 'password',
        username,
        password: contrasena,
      });
      expect(login.status).toBe(200);
      expect(await sesionesKeycloak(keycloakId)).toBe(1);

      const res = await request(app.getHttpServer())
        .post(`/usuarios/${id}/cerrar-sesiones`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(res.body).toEqual({ id, sesionesCerradas: true });

      expect(await sesionesKeycloak(keycloakId)).toBe(0);
      // Su refresh token ya no sirve: el dispositivo tiene que ingresar de nuevo.
      const refresh = await pedirToken({
        grant_type: 'refresh_token',
        refresh_token: login.body.refresh_token,
      });
      expect(refresh.status).toBe(400);
      expect(refresh.body.error).toBe('invalid_grant');
      // Sigue activo de los dos lados.
      const usuarioKc = await (
        await fetch(base, { headers: await adminHeaders() })
      ).json();
      expect(usuarioKc.enabled).toBe(true);
      const fila = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${creado?.tenantId}, true)`;
        return tx.usuario.findUnique({ where: { id } });
      });
      expect(fila?.activo).toBe(true);
    },
  );

  itConAdmin(
    '[TC-I-070] Usuarios: ADMIN no puede cerrar las sesiones de la cuenta de cocina de otro tenant (404)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      await request(app.getHttpServer())
        .post(`/usuarios/cocina/${COCINA_B_KEYCLOAK_ID}/cerrar-sesiones`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    },
  );
});
