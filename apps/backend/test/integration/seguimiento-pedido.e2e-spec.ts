import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;

const TENANT_DEMO_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_DEMO_ID = '22222222-2222-2222-2222-222222222222';
const MESA_DEMO_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_CARTA_DEMO_ID = '55555555-5555-5555-5555-555555555555';

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

function esperarEvento<T = unknown>(
  socket: Socket,
  evento: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout esperando el evento "${evento}"`)),
      timeoutMs,
    );
    socket.once(evento, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Seguimiento del comensal (HU-006) - e2e', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tokenComensal: string;

  const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://localhost:${port}`;

    const authRes = await fetch(`${baseUrl}/auth/comensal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_DEMO_ID,
        mesaId: MESA_DEMO_ID,
      }),
    });
    if (!authRes.ok) {
      throw new Error(`No se pudo emitir token de comensal: ${authRes.status}`);
    }
    tokenComensal = (await authRes.json()).accessToken;
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  function conectar(token?: string): Socket {
    return io(baseUrl, {
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
  }

  async function crearPedido(): Promise<string> {
    const res = await fetch(`${baseUrl}/pedidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenComensal}`,
      },
      body: JSON.stringify({
        restauranteId: RESTAURANTE_DEMO_ID,
        mesaId: MESA_DEMO_ID,
        idempotencyKey: `e2e-seguimiento-${Date.now()}-${Math.random()}`,
        items: [{ itemCartaId: ITEM_CARTA_DEMO_ID, cantidad: 1 }],
      }),
    });
    if (!res.ok) {
      throw new Error(`No se pudo crear el pedido de prueba: ${res.status}`);
    }
    return (await res.json()).id as string;
  }

  it('[HU-006] pedido:seguir devuelve el estado actual de inmediato al suscribirse', async () => {
    const pedidoId = await crearPedido();
    const socket = conectar(tokenComensal);
    try {
      socket.emit('pedido:seguir', { pedidoId });
      const actualizado = await esperarEvento<{ id: string; estado: string }>(
        socket,
        'pedido:actualizado',
      );
      expect(actualizado.id).toBe(pedidoId);
      expect(actualizado.estado).toBe('RECIBIDO');
    } finally {
      socket.disconnect();
    }
  });

  it('[HU-006 seguridad] pedido:seguir con un pedidoId inventado: error, no une a ninguna sala', async () => {
    const socket = conectar(tokenComensal);
    try {
      socket.emit('pedido:seguir', { pedidoId: 'no-existe' });
      const errorPayload = await esperarEvento<{ message: string }>(
        socket,
        'error',
      );
      expect(errorPayload.message).toBe('Pedido no encontrado');
    } finally {
      socket.disconnect();
    }
  });

  itConMozo(
    '[HU-006] DoD: Mozo marca "En preparacion" -> el comensal que sigue ESE pedido lo recibe en menos de 1s',
    async () => {
      const pedidoId = await crearPedido();

      const socketComensal = conectar(tokenComensal);
      socketComensal.emit('pedido:seguir', { pedidoId });
      await esperarEvento(socketComensal, 'pedido:actualizado');

      const tokenMozo = await getToken(
        MOZO_USER as string,
        MOZO_PASS as string,
      );
      const socketMozo = conectar(tokenMozo);

      try {
        await esperarEvento(socketMozo, 'pedidos:snapshot');

        const inicio = Date.now();
        socketMozo.emit('pedido:transicion', {
          pedidoId,
          nuevoEstado: 'EN_PREPARACION',
        });

        const actualizado = await esperarEvento<{
          id: string;
          estado: string;
        }>(socketComensal, 'pedido:actualizado');
        const transcurrido = Date.now() - inicio;

        expect(actualizado.id).toBe(pedidoId);
        expect(actualizado.estado).toBe('EN_PREPARACION');
        expect(transcurrido).toBeLessThan(1000);
      } finally {
        socketComensal.disconnect();
        socketMozo.disconnect();
      }
    },
    10000,
  );
});
