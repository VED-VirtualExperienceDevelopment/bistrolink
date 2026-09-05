import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';

// ── Config de Keycloak para pedir tokens reales (password grant) ───────────
// Mismo patron que tenant-isolation.e2e-spec.ts / usuarios.e2e-spec.ts.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111'; // tenant Demo
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';

// Fixture de tenant-isolation.e2e-spec.ts, reusada aca para el test de
// aislamiento con un token de un tenant REAL distinto - no un tenantId
// arbitrario auto-asignado por el cliente como hacia la version vieja de
// este test (ese auto-asignado era justo el agujero de seguridad que
// HU-004 cerro: antes, cualquier cliente podia unirse a la sala de
// CUALQUIER tenant con solo emitir 'join-tenant' con el id que quisiera).
const TENANT_B_USER = process.env.TEST_TENANT_B_USERNAME;
const TENANT_B_PASS = process.env.TEST_TENANT_B_PASSWORD;

// El socket que OBSERVA pedido:nuevo tiene que ser un token de MOZO/ADMIN/
// COCINA: desde el fix de seguridad de HU-004 (checklist "Comensal -> 403"),
// solo esos roles pueden conectarse al canal del KDS. El comensal sigue
// creando el pedido por REST igual que siempre - lo que cambio es quien
// puede quedarse escuchando el feed completo de la cocina, y el comensal
// nunca deberia poder hacerlo.
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
    throw new Error(
      `No se pudo obtener token para ${username}: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  return data.access_token as string;
}

function conectar(baseUrl: string, token: string): Socket {
  // Ya no hace falta 'join-tenant': el join a la sala es automatico y
  // solo tras validar el JWT en handleConnection (ver HU-004).
  return io(baseUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
}

describe('WebSocket KDS (HU-003 + HU-004) - emision de pedido:nuevo', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokenComensalDemo: string;

  const itConTenantB = TENANT_B_USER && TENANT_B_PASS ? it : it.skip;
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
    tokenComensalDemo = authRes.body.accessToken;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  itConMozo(
    '[TC-I-KDS-006] emite pedido:nuevo al KDS en menos de 500ms tras confirmar',
    async () => {
      const tokenMozo = await getToken(
        MOZO_USER as string,
        MOZO_PASS as string,
      );

      // Warm-up: la primera query real de esta instancia de la app carga con
      // el costo de conexión a Postgres/inicialización de Prisma, que no es
      // representativo del rendimiento real del sistema ya en marcha — mismo
      // criterio que aplicamos al test de Lighthouse en HU-001. Se descarta
      // el resultado, solo importa que la app ya esté "tibia" para la medición
      // real de abajo.
      await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${tokenComensalDemo}`)
        .send({
          restauranteId: RESTAURANTE_ID,
          mesaId: MESA_ID,
          idempotencyKey: `warmup-${Date.now()}`,
          items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
        })
        .expect(201);

      await new Promise<void>((resolve, reject) => {
        // El socket que OBSERVA pedido:nuevo es de MOZO (personal de
        // cocina/sala) - el comensal crea el pedido por REST arriba, pero
        // nunca deberia poder quedarse escuchando el feed completo del KDS.
        const socket = conectar(baseUrl, tokenMozo);
        let inicio: number;

        socket.on('error', (e: { message: string }) =>
          reject(new Error(`Conexion WS rechazada: ${e.message}`)),
        );

        // El snapshot inicial confirma que la conexion ya quedo autenticada
        // y unida a la sala del tenant — recien ahi tiene sentido esperar
        // el pedido:nuevo, igual que hace un cliente real.
        socket.on('pedidos:snapshot', () => {
          socket.on('pedido:nuevo', (pedido: { id: string }) => {
            try {
              const duracionMs = Date.now() - inicio;
              expect(duracionMs).toBeLessThan(500);
              expect(pedido.id).toBeDefined();
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
                .set('Authorization', `Bearer ${tokenComensalDemo}`)
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
    },
    15000,
  );

  itConTenantB(
    '[TC-I-KDS-007] NO emite el pedido a un cliente conectado con un token de OTRO tenant real (aislamiento)',
    (done) => {
      getToken(TENANT_B_USER as string, TENANT_B_PASS as string)
        .then((tokenTenantB) => {
          const socketTenantB = conectar(baseUrl, tokenTenantB);
          let recibioAlgo = false;

          socketTenantB.on('error', (e: { message: string }) =>
            done(new Error(`Conexion WS rechazada: ${e.message}`)),
          );

          socketTenantB.on('pedidos:snapshot', () => {
            socketTenantB.on('pedido:nuevo', () => {
              recibioAlgo = true;
            });

            setTimeout(async () => {
              try {
                await request(app.getHttpServer())
                  .post('/pedidos')
                  .set('Authorization', `Bearer ${tokenComensalDemo}`)
                  .send({
                    restauranteId: RESTAURANTE_ID,
                    mesaId: MESA_ID,
                    idempotencyKey: `ws-aislamiento-${Date.now()}`,
                    items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
                  })
                  .expect(201);

                setTimeout(() => {
                  expect(recibioAlgo).toBe(false);
                  socketTenantB.disconnect();
                  done();
                }, 700);
              } catch (err) {
                socketTenantB.disconnect();
                done(err as Error);
              }
            }, 100);
          });
        })
        .catch(done);
    },
    10000,
  );
});
