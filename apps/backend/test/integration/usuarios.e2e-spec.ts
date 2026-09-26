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
