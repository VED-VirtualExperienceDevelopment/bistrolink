import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME ?? 'admin-test';
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;

// Restaurante real del tenant A, ya insertado en Postgres durante el Paso 3
// de la guía de Keycloak/RLS.
const RESTAURANTE_TENANT_A = '87152395-a721-4651-99b8-f21075d1d8ae';
// Restaurante del tenant B (existe, pero NO pertenece al Admin del tenant A) —
// usado para probar que el endpoint rechaza restaurantes ajenos.
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

describe('Gestión de usuarios (HU-013) - e2e', () => {
  let app: INestApplication;

  // Si falta la fixture, saltamos el test explícitamente (Jest lo reporta
  // como "skipped", no como "passed") en vez de retornar en silencio desde
  // adentro del test — así un pipeline de CI mal configurado se nota en el
  // resumen, no queda escondido detrás de un ✓ que no verificó nada.
  const itConAdmin = ADMIN_PASS ? it : it.skip;

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

  itConAdmin(
    '[TC-I-006] Usuarios: ADMIN puede crear un Mozo en su propio restaurante (201)',
    async () => {
      const token = await getToken(ADMIN_USER, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .post('/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          // Username único por corrida, para poder repetir el test sin
          // chocar con un usuario ya creado en Keycloak.
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
          restauranteId: RESTAURANTE_TENANT_B, // ajeno al tenant de admin-test
        })
        .expect(403);
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
