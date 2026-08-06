import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../src/app.module';

// ── Config de Keycloak para pedir tokens reales (password grant) ───────────
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? 'admin-test';

// Fixtures — ver el bloque de "Setup requerido" más abajo para crearlos.
const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;

const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;

const NO_TENANT_USER = process.env.TEST_NO_TENANT_USERNAME;
const NO_TENANT_PASS = process.env.TEST_NO_TENANT_PASSWORD;

const TENANT_B_USER = process.env.TEST_TENANT_B_USERNAME;
const TENANT_B_PASS = process.env.TEST_TENANT_B_PASSWORD;

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

describe('Aislamiento multi-tenant (Keycloak + RLS) - e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Caso base: sin token, siempre debe rechazar (no requiere fixtures extra) ──
  it('rechaza un request sin token (401)', async () => {
    await request(app.getHttpServer()).get('/test/mi-tenant').expect(401);
  });

  // ── Caso base: ADMIN válido puede leer los datos de su propio tenant ──
  it('un ADMIN autenticado puede leer los datos de su propio tenant (200)', async () => {
    if (!ADMIN_PASS) {
      console.warn(
        'Saltando: falta TEST_ADMIN_PASSWORD en el entorno de test.',
      );
      return;
    }
    const token = await getToken(ADMIN_USER, ADMIN_PASS);
    const res = await request(app.getHttpServer())
      .get('/test/mi-tenant')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ── Requiere un usuario de prueba con rol COCINA (ver Setup requerido) ──
  it('un rol COCINA recibe 403 en un endpoint solo-admin', async () => {
    if (!COCINA_USER || !COCINA_PASS) {
      console.warn(
        'Saltando: faltan TEST_COCINA_USERNAME/TEST_COCINA_PASSWORD.',
      );
      return;
    }
    const token = await getToken(COCINA_USER, COCINA_PASS);
    await request(app.getHttpServer())
      .get('/test/solo-admin')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  // ── Requiere un usuario de prueba SIN el atributo tenant_id (ver Setup) ──
  it('un usuario sin tenant_id es rechazado (401)', async () => {
    if (!NO_TENANT_USER || !NO_TENANT_PASS) {
      console.warn(
        'Saltando: faltan TEST_NO_TENANT_USERNAME/TEST_NO_TENANT_PASSWORD.',
      );
      return;
    }
    const token = await getToken(NO_TENANT_USER, NO_TENANT_PASS);
    await request(app.getHttpServer())
      .get('/test/mi-tenant')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  // ── Requiere un segundo tenant + usuario (ver Setup requerido) ──
  it('el tenant B no ve datos del tenant A (aislamiento cruzado)', async () => {
    if (!ADMIN_PASS || !TENANT_B_USER || !TENANT_B_PASS) {
      console.warn(
        'Saltando: faltan TEST_TENANT_B_USERNAME/TEST_TENANT_B_PASSWORD (o TEST_ADMIN_PASSWORD).',
      );
      return;
    }

    const tokenA = await getToken(ADMIN_USER, ADMIN_PASS);
    const resA = await request(app.getHttpServer())
      .get('/test/mi-tenant')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const idsA = resA.body.map((r: { id: string }) => r.id);

    const tokenB = await getToken(TENANT_B_USER, TENANT_B_PASS);
    const resB = await request(app.getHttpServer())
      .get('/test/mi-tenant')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const idsB = resB.body.map((r: { id: string }) => r.id);

    // Ningún id del tenant A debería aparecer en la respuesta del tenant B
    expect(idsA.some((id: string) => idsB.includes(id))).toBe(false);
  });
});
