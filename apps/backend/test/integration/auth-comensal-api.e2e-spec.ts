import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import {
  DURACION_TOKEN_INVITADO_S,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';
import {
  asegurarClaveQr,
  sesionDeMesa,
  tokenQrDeMesa,
} from './support/qr-mesa';

// HU-052: /auth/comensal entrega el token de invitado que firma la API, con
// el canal por el que entró el comensal, y ese token sirve en los endpoints
// del comensal. Con la base, el RLS y Keycloak reales. Desde BL-581 es el
// único emisor. La clave la pone support/clave-comensal.ts si el entorno no
// trae una. El link de pago (/auth/comensal/link-pago) lo cubre
// link-pago.e2e-spec.ts.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';

describe('HU-052: /auth/comensal entrega el token de invitado de la API', () => {
  let app: INestApplication;
  let verificador: TokenInvitado;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    asegurarClaveQr();
    process.env.COMENSAL_TOKEN_CLAVE ||= randomBytes(32).toString('base64');
    verificador = new TokenInvitado({
      claveActual: process.env.COMENSAL_TOKEN_CLAVE,
    });

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

  it('[TC-I-238] retiro y mesa por QR entregan el token de la API con su canal, y ese token sirve para pedir', async () => {
    const retiro = await http()
      .post('/auth/comensal')
      .send({ tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID })
      .expect(200);

    const qrToken = await tokenQrDeMesa(app, TENANT_ID, MESA_ID);
    const sesionMesa = await sesionDeMesa(app, TENANT_ID, MESA_ID);
    const mesa = await http()
      .post('/auth/comensal/mesa')
      .send({ qrToken, sesionMesa })
      .expect(200);

    // Mismo contrato que con Keycloak.
    for (const res of [retiro, mesa]) {
      expect(Object.keys(res.body).sort()).toEqual([
        'accessToken',
        'expiresIn',
      ]);
      expect(res.body.expiresIn).toBe(DURACION_TOKEN_INVITADO_S);
    }

    // Lo firmó la API (si no, verificar lanza), con el canal de cada uno.
    expect(verificador.verificar(retiro.body.accessToken)).toMatchObject({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      roles: ['COMENSAL'],
      canal: { tipo: 'retiro', restauranteId: RESTAURANTE_ID },
    });
    expect(verificador.verificar(mesa.body.accessToken)).toMatchObject({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      roles: ['COMENSAL'],
      canal: { tipo: 'mesa', mesaId: MESA_ID, sesionId: sesionMesa },
    });

    // Body vacío: si llega a la validación (400), el token pasó la
    // autenticación y el rol COMENSAL.
    for (const res of [retiro, mesa]) {
      await http()
        .post('/pedidos')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .send({})
        .expect(400);
    }
  });
});
