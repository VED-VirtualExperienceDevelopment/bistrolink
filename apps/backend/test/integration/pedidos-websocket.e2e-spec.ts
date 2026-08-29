import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';

describe('WebSocket KDS (HU-003)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let token: string;

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
    token = authRes.body.accessToken;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

    it('emite pedido:nuevo al KDS en menos de 500ms tras confirmar', async () => {
    // Warm-up: la primera query real de esta instancia de la app carga con
    // el costo de conexión a Postgres/inicialización de Prisma, que no es
    // representativo del rendimiento real del sistema ya en marcha — mismo
    // criterio que aplicamos al test de Lighthouse en HU-001. Se descarta
    // el resultado, solo importa que la app ya esté "tibia" para la medición
    // real de abajo.
    await request(app.getHttpServer())
      .post('/pedidos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        restauranteId: RESTAURANTE_ID,
        mesaId: MESA_ID,
        idempotencyKey: `warmup-${Date.now()}`,
        items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
      })
      .expect(201);

    await new Promise<void>((resolve, reject) => {
      const socket: Socket = io(baseUrl, { transports: ['websocket'] });
      let inicio: number;

      socket.on('connect', () => {
        socket.emit('join-tenant', TENANT_ID);

        socket.on('pedido:nuevo', (pedido) => {
          try {
            const duracionMs = Date.now() - inicio;
            expect(duracionMs).toBeLessThan(500);
            expect(pedido.tenantId).toBe(TENANT_ID);
            socket.disconnect();
            resolve();
          } catch (err) {
            socket.disconnect();
            reject(err);
          }
        });

        setTimeout(async () => {
          try {
            inicio = Date.now();
            await request(app.getHttpServer())
              .post('/pedidos')
              .set('Authorization', `Bearer ${token}`)
              .send({
                restauranteId: RESTAURANTE_ID,
                mesaId: MESA_ID,
                idempotencyKey: `ws-test-${Date.now()}`,
                items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
              })
              .expect(201);
          } catch (err) {
            reject(err);
          }
        }, 100);
      });
    });
  }, 15000);

  it('NO emite el pedido a un cliente conectado a la sala de OTRO tenant (aislamiento)', (done) => {
    const socketAjeno: Socket = io(baseUrl, { transports: ['websocket'] });
    let recibioAlgo = false;

    socketAjeno.on('connect', () => {
      socketAjeno.emit('join-tenant', TENANT_ID_AJENO);
      socketAjeno.on('pedido:nuevo', () => {
        recibioAlgo = true;
      });

      setTimeout(async () => {
        try {
          await request(app.getHttpServer())
            .post('/pedidos')
            .set('Authorization', `Bearer ${token}`)
            .send({
              restauranteId: RESTAURANTE_ID,
              mesaId: MESA_ID,
              idempotencyKey: `ws-aislamiento-${Date.now()}`,
              items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
            })
            .expect(201);

          setTimeout(() => {
            expect(recibioAlgo).toBe(false);
            socketAjeno.disconnect();
            done();
          }, 700);
        } catch (err) {
          socketAjeno.disconnect();
          done(err);
        }
      }, 100);
    });
  }, 10000);
});
