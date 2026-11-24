import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import {
  CanalInvitado,
  TokenInvitado,
} from '../../src/auth-comensal/token-invitado';
import {
  asegurarClaveQr,
  sesionDeMesa,
  tokenQrDeMesa,
} from './support/qr-mesa';

// HU-052 (BL-580): el token de invitado solo sirve en el canal por el que se
// emitió. Con la base, el RLS, los QR y las sesiones de mesa reales.
//
// Los tokens se firman acá con la clave de esta corrida (la misma que lee la
// app): así se puede armar el token de una mesa, de un link o del retiro sin
// pasar por cada flujo. La verificación es la real de la API. Con un body
// vacío, un 400 de validación quiere decir que el token pasó los guards.
// Las reglas de POST /pedidos que miran el body corren después de la
// validación: ahí va un pedido válido, con un ítem que no existe (el 403
// llega antes de buscarlo, así que no se crea nada).

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_1 = '33333333-3333-3333-3333-333333333333';
const MESA_2 = '33333333-3333-3333-3333-333333333334';

process.env.COMENSAL_TOKEN_CLAVE ||= randomBytes(32).toString('base64');
const CLAVE = process.env.COMENSAL_TOKEN_CLAVE;

describe('HU-052 (BL-580): token de invitado atado a su canal', () => {
  let app: INestApplication;
  const tokens = new TokenInvitado({ claveActual: CLAVE });

  const http = () => request(app.getHttpServer());
  const token = (canal: CanalInvitado) =>
    tokens.emitir({ tenantId: TENANT_ID, restauranteId: RESTAURANTE_ID, canal })
      .accessToken;

  /** Un pedido para retirar que pasa la validación (el ítem no existe). */
  const pedidoValido = (restauranteId?: string) => ({
    idempotencyKey: `bl-580-${randomUUID()}`,
    items: [{ itemCartaId: randomUUID(), cantidad: 1 }],
    ...(restauranteId ? { restauranteId } : {}),
  });

  /** QR y sesión abierta de una mesa, como los manda el frontend. */
  const headersDeMesa = async (mesaId: string) => ({
    'X-Mesa-Token': await tokenQrDeMesa(app, TENANT_ID, mesaId),
    'X-Mesa-Sesion': await sesionDeMesa(app, TENANT_ID, mesaId),
  });

  beforeAll(async () => {
    asegurarClaveQr();
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

  it('[TC-I-239] el token de la mesa 1 sirve con el QR de la mesa 1; con el QR de la mesa 2 → 403; sin QR → 400', async () => {
    const mesa1 = await headersDeMesa(MESA_1);
    const mesa2 = await headersDeMesa(MESA_2);
    const deLaMesa1 = token({
      tipo: 'mesa',
      mesaId: MESA_1,
      sesionId: mesa1['X-Mesa-Sesion'],
    });

    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${deLaMesa1}`)
      .set(mesa1)
      .send({})
      .expect(400);

    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${deLaMesa1}`)
      .set(mesa2)
      .send({})
      .expect(403);

    // Sin el QR no sirve para pedir «para retirar».
    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${deLaMesa1}`)
      .send({})
      .expect(400);
  });

  it('[TC-I-240] el token de una sesión anterior de la mesa (cerrada y vuelta a abrir) → 410 SESION_VENCIDA, aunque traiga el QR y la sesión actual', async () => {
    const mesa1 = await headersDeMesa(MESA_1);
    const deOtraSesion = token({
      tipo: 'mesa',
      mesaId: MESA_1,
      sesionId: randomUUID(),
    });

    const res = await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${deOtraSesion}`)
      .set(mesa1)
      .send({})
      .expect(410);
    expect(res.body.codigo).toBe('SESION_VENCIDA');
  });

  it('[TC-I-241] el token del link del pedido A no sirve con el pedido B (403) ni para hacer pedidos (403)', async () => {
    const pedidoA = randomUUID();
    const pedidoB = randomUUID();
    const delLinkA = token({ tipo: 'link', pedidoId: pedidoA });

    // 403 antes de buscar el pedido: no dice si B existe.
    await http()
      .get(`/pedidos/${pedidoB}/pagos`)
      .set('Authorization', `Bearer ${delLinkA}`)
      .expect(403);

    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${delLinkA}`)
      .send(pedidoValido(RESTAURANTE_ID))
      .expect(403);
  });

  it('[TC-I-242] el token del retiro no sirve con el QR de una mesa (403) ni para pedir en otro restaurante (403)', async () => {
    const retiro = token({ tipo: 'retiro', restauranteId: RESTAURANTE_ID });

    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${retiro}`)
      .set(await headersDeMesa(MESA_1))
      .send({})
      .expect(403);

    await http()
      .post('/pedidos')
      .set('Authorization', `Bearer ${retiro}`)
      .send(pedidoValido(randomUUID()))
      .expect(403);
  });
});
