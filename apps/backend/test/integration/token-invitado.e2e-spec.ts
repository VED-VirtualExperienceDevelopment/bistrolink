import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import {
  AUDIENCIA_TOKEN_INVITADO,
  ISSUER_TOKEN_INVITADO,
  kidDeClave,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';

// HU-052 (BL-578): la API acepta el token de invitado del comensal (firmado
// por la API) en los endpoints del comensal, y en ningún otro. Con la base,
// el RLS y Keycloak reales.
//
// La clave de esta corrida se genera acá si el entorno no trae una: la
// estrategia la lee al crear la app, en el beforeAll.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';

process.env.COMENSAL_TOKEN_CLAVE ||= randomBytes(32).toString('base64');
const CLAVE = process.env.COMENSAL_TOKEN_CLAVE;

describe('HU-052 (BL-578): token de invitado del comensal', () => {
  let app: INestApplication;
  const tokens = new TokenInvitado({ claveActual: CLAVE });

  const http = () => request(app.getHttpServer());
  const invitado = () =>
    tokens.emitir({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_ID },
    }).accessToken;

  /** Un token con el formato del invitado, firmado a mano. */
  const firmarAMano = (clave: string, opciones: jwt.SignOptions = {}) =>
    jwt.sign(
      {
        tenant_id: TENANT_ID,
        canal: { tipo: 'retiro', restaurante_id: RESTAURANTE_ID },
      },
      clave,
      {
        algorithm: 'HS256',
        expiresIn: 60,
        issuer: ISSUER_TOKEN_INVITADO,
        audience: AUDIENCIA_TOKEN_INVITADO,
        subject: 'comensal-de-prueba',
        keyid: kidDeClave(clave),
        ...opciones,
      },
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts (los tests no levantan main.ts).
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('[TC-I-235] el token de invitado pasa la autenticación y el rol en los endpoints del comensal, igual que el de Keycloak', async () => {
    // Body vacío: si llega a la validación (400), ya pasó la autenticación
    // y el rol COMENSAL. Sin token, 401.
    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${invitado()}`)
      .send({})
      .expect(400);

    const keycloak = await http()
      .post('/auth/comensal')
      .send({ tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID })
      .expect(200);
    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${keycloak.body.accessToken}`)
      .send({})
      .expect(400);

    await http().post('/pedidos').send({}).expect(401);
  });

  it('[TC-I-236] el token de invitado no sirve en los endpoints del personal ni de la plataforma', async () => {
    const token = invitado();

    // Controlador del comensal, método del personal: pasa la autenticación,
    // pero RolesGuard lo frena (el invitado es siempre COMENSAL).
    await http()
      .get('/mesas/layout')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    // Controladores del personal y de la plataforma: ni lo consideran.
    for (const ruta of ['/usuarios', '/auditoria', '/admin/reportes']) {
      await http()
        .get(ruta)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
    await http()
      .get('/plataforma/establecimientos')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('[TC-I-237] se rechaza un token de invitado firmado con otra clave, vencido, con otra audiencia o que dice ser de Keycloak', async () => {
    const otraClave = randomBytes(32).toString('base64');
    const invalidos = [
      firmarAMano(otraClave),
      firmarAMano(CLAVE, { expiresIn: -60 }),
      firmarAMano(CLAVE, { audience: 'account' }),
      // Con nuestra clave y nuestro kid, pero el emisor de Keycloak: no se
      // verifica nunca con la clave de la API.
      firmarAMano(CLAVE, {
        issuer: `${process.env.KEYCLOAK_URL ?? 'http://localhost:8080'}/realms/${process.env.KEYCLOAK_REALM ?? 'bistrolink'}`,
      }),
    ];

    for (const token of invalidos) {
      await http()
        .post('/pedidos')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(401);
    }
  });
});
