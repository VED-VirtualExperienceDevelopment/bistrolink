import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';

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
  if (!res.ok) {
    throw new Error(`No se pudo obtener token para ${username}: ${res.status}`);
  }
  return (await res.json()).access_token as string;
}

describe('WebSocket KDS (HU-018) - pedido listo para entregar', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokenComensal: string;
  let tokenMozo: string;

  const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;

    const authRes = await request(app.getHttpServer())
      .post('/auth/comensal')
      .send({ tenantId: TENANT_ID, mesaId: MESA_ID })
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
    '[TC-I-020] KDS: emite pedido:actualizado(LISTO_PARA_ENTREGAR) en menos de 500ms',
    async () => {
      const pedidoRes = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${tokenComensal}`)
        .send({
          restauranteId: RESTAURANTE_ID,
          mesaId: MESA_ID,
          idempotencyKey: `hu018-${Date.now()}`,
          items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
        })
        .expect(201);
      const pedidoId = pedidoRes.body.id;

      await new Promise<void>((resolve, reject) => {
        const socket: Socket = io(baseUrl, {
          auth: { token: tokenMozo },
          transports: ['websocket'],
          forceNew: true,
        });
        let inicio: number;

        socket.on('error', (e: { message: string }) =>
          reject(new Error(`Conexion WS rechazada: ${e.message}`)),
        );

        socket.on('pedidos:snapshot', () => {
          // Primera transicion (no cronometrada - solo deja el pedido en
          // el estado previo al que si nos importa medir).
          socket.emit('pedido:transicion', {
            pedidoId,
            nuevoEstado: 'EN_PREPARACION',
          });
        });

        socket.on(
          'pedido:actualizado',
          (payload: {
            id: string;
            estado: string;
            mesaNumero: number;
            lineas: unknown[];
          }) => {
            if (payload.id !== pedidoId) return;

            if (payload.estado === 'EN_PREPARACION') {
              inicio = Date.now();
              socket.emit('pedido:transicion', {
                pedidoId,
                nuevoEstado: 'LISTO_PARA_ENTREGAR',
              });
              return;
            }

            if (payload.estado === 'LISTO_PARA_ENTREGAR') {
              try {
                const duracionMs = Date.now() - inicio;
                expect(duracionMs).toBeLessThan(500);
                expect(payload.mesaNumero).toBe(1);
                expect(Array.isArray(payload.lineas)).toBe(true);
                // BL-66: nunca precio/dato de pago en la notificacion
                expect(payload).not.toHaveProperty('pago');
                expect(JSON.stringify(payload)).not.toMatch(/precio|subtotal/i);
                socket.disconnect();
                resolve();
              } catch (err) {
                socket.disconnect();
                reject(err);
              }
            }
          },
        );
      });
    },
    15000,
  );
});
