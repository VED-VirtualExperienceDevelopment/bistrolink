import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { asegurarClaveQr, tokenQrDeMesa } from './support/qr-mesa';
import { conPagoFalso, pagarPedidoDeMesa } from './support/pago-falso';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';

const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;

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
  if (!res.ok) throw new Error(`No se pudo obtener token: ${res.status}`);
  return (await res.json()).access_token as string;
}

function conectar(baseUrl: string, token: string): Socket {
  return io(baseUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
}

describe('WebSocket KDS (HU-018/BL-65) - reconexion no pierde notificaciones', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokenComensal: string;
  // BL-204: la mesa solo se usa con el token de su QR.
  let qrToken: string;
  let tokenMozo: string;
  let pedidoId: string;

  const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;

  beforeAll(async () => {
    asegurarClaveQr();
    // BL-311: pasarela falsa (ver support/pago-falso.ts).
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;

    qrToken = await tokenQrDeMesa(app, TENANT_ID, MESA_ID);
    const authRes = await request(app.getHttpServer())
      .post('/auth/comensal/mesa')
      .send({ qrToken })
      .expect(200);
    tokenComensal = authRes.body.accessToken;

    if (MOZO_USER && MOZO_PASS) {
      tokenMozo = await getToken(MOZO_USER, MOZO_PASS);
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  itConMozo(
    '[TC-I-021] KDS: pedido LISTO_PARA_ENTREGAR sigue apareciendo en el snapshot tras reconectar',
    async () => {
      const pedidoRes = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${tokenComensal}`)
        .set('X-Mesa-Token', qrToken)
        .send({
          restauranteId: RESTAURANTE_ID,
          idempotencyKey: `hu018-recon-${Date.now()}`,
          items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
        })
        .expect(201);
      pedidoId = pedidoRes.body.id;

      // BL-311 (prepago): el pedido llega al KDS recién con el pago aprobado.
      await pagarPedidoDeMesa(app, pedidoId, tokenComensal, qrToken);

      // Llevar el pedido hasta LISTO_PARA_ENTREGAR con un primer socket,
      // que despues se desconecta (simulando al mozo perdiendo conexion).
      await new Promise<void>((resolve, reject) => {
        const socket = conectar(baseUrl, tokenMozo);
        socket.on('error', (e: { message: string }) =>
          reject(new Error(e.message)),
        );
        socket.on('pedidos:snapshot', () => {
          socket.emit('pedido:transicion', {
            pedidoId,
            nuevoEstado: 'EN_PREPARACION',
          });
        });
        socket.on('pedido:actualizado', (p: { id: string; estado: string }) => {
          if (p.id !== pedidoId) return;
          if (p.estado === 'EN_PREPARACION') {
            socket.emit('pedido:transicion', {
              pedidoId,
              nuevoEstado: 'LISTO_PARA_ENTREGAR',
            });
          }
          if (p.estado === 'LISTO_PARA_ENTREGAR') {
            socket.disconnect();
            resolve();
          }
        });
      });

      // "Reconexion": un socket NUEVO del mismo mozo, sin ningun estado
      // previo en memoria — todo lo que sepa tiene que venirle del snapshot.
      await new Promise<void>((resolve, reject) => {
        const socket = conectar(baseUrl, tokenMozo);
        socket.on('error', (e: { message: string }) =>
          reject(new Error(e.message)),
        );
        socket.on(
          'pedidos:snapshot',
          (pendientes: { id: string; estado: string }[]) => {
            try {
              const encontrado = pendientes.find((p) => p.id === pedidoId);
              expect(encontrado).toBeDefined();
              expect(encontrado?.estado).toBe('LISTO_PARA_ENTREGAR');
              socket.disconnect();
              resolve();
            } catch (err) {
              socket.disconnect();
              reject(err);
            }
          },
        );
      });
    },
    15000,
  );
});
