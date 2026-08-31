import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';

// ── Config de Keycloak para pedir tokens reales (password grant) ───────────
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

// Fixtures ya existentes (tenant Ejemplo) - alcanza para el test de
// autorizacion, que no necesita un pedido real, solo un rol invalido.
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;

// Fixture NUEVA requerida para estos tests (Setup requerido, ver mas abajo).
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;

// Tenant "Demo" del seed (Anexo/seed.ts) - el unico con mesa/restaurante/
// item de carta ya cargados, necesarios para poder crear un pedido real
// via /auth/comensal + POST /pedidos.
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

async function getComensalToken(): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL.replace('8080', '3001')}/auth/comensal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: TENANT_DEMO_ID,
        restauranteId: RESTAURANTE_DEMO_ID,
        mesaId: MESA_DEMO_ID,
      }),
    },
  ).catch(() => null);
  // Nota: esto le pega directo al backend real en :3001 (no a `app` de este
  // test), porque AuthComensalService arma su propio token contra Keycloak
  // por fuera del request HTTP entrante - no hay forma de invocarlo sobre
  // la instancia in-memory de `app` sin levantar tambien su servidor HTTP.
  if (!res || !res.ok) {
    throw new Error(
      'No se pudo emitir token de comensal (backend real en :3001 debe estar corriendo)',
    );
  }
  const data = await res.json();
  return data.accessToken as string;
}

/** Crea un pedido real de prueba en el tenant Demo, vía POST /pedidos. */
async function crearPedidoDePrueba(baseUrl: string): Promise<string> {
  const tokenComensal = await getComensalToken();
  const res = await fetch(`${baseUrl}/pedidos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenComensal}`,
    },
    body: JSON.stringify({
      restauranteId: RESTAURANTE_DEMO_ID,
      mesaId: MESA_DEMO_ID,
      idempotencyKey: `e2e-kds-${Date.now()}-${Math.random()}`,
      items: [{ itemCartaId: ITEM_CARTA_DEMO_ID, cantidad: 1 }],
    }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo crear el pedido de prueba: ${res.status}`);
  }
  const pedido = await res.json();
  return pedido.id as string;
}

/** Espera un evento del socket con timeout, para no colgar el test si algo falla. */
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

describe('Canal WebSocket del KDS (HU-004) - e2e', () => {
  let app: INestApplication;
  let baseUrl: string;
  let wsUrl: string;

  // Mismo patron que los otros e2e-spec: si falta la fixture, saltamos
  // explicitamente con it.skip (Jest lo reporta como "skipped", no
  // "passed") en vez de que el test retorne en silencio sin verificar nada.
  const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;
  const itConCocina = COCINA_USER && COCINA_PASS ? it : it.skip;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0); // puerto aleatorio libre, necesario para conexiones WS reales

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://localhost:${port}`;
    wsUrl = baseUrl;
  });

  afterAll(async () => {
    await app.close();
  });

  function conectar(token?: string): Socket {
    return io(wsUrl, {
      auth: token ? { token } : {},
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
  }

  it('[TC-I-KDS-001] KDS: rechaza la conexion WS sin token', async () => {
    const socket = conectar(undefined);
    try {
      const errorPayload = await esperarEvento<{ message: string }>(
        socket,
        'error',
      );
      expect(errorPayload.message).toBeDefined();
    } finally {
      socket.disconnect();
    }
  });

  itConMozo(
    '[TC-I-KDS-002] KDS: conecta con JWT valido (MOZO) y recibe el snapshot inicial',
    async () => {
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);
      const socket = conectar(token);
      try {
        const snapshot = await esperarEvento<unknown[]>(
          socket,
          'pedidos:snapshot',
        );
        expect(Array.isArray(snapshot)).toBe(true);
      } finally {
        socket.disconnect();
      }
    },
  );

  itConCocina(
    '[TC-I-KDS-003] KDS: rol COCINA no puede operar transiciones de estado (RD.06 - solo lectura)',
    async () => {
      const token = await getToken(
        COCINA_USER as string,
        COCINA_PASS as string,
      );
      const socket = conectar(token);
      try {
        await esperarEvento(socket, 'pedidos:snapshot'); // esperar a que termine de conectar

        socket.emit('pedido:transicion', {
          pedidoId: 'cualquier-id', // no llega a resolverse: el rechazo es antes de tocar la DB
          nuevoEstado: 'EN_PREPARACION',
        });

        const errorPayload = await esperarEvento<{ message: string }>(
          socket,
          'error',
        );
        expect(errorPayload.message).toContain('de solo lectura');
      } finally {
        socket.disconnect();
      }
    },
  );

  itConMozo(
    '[TC-I-KDS-004] KDS: MOZO marca un pedido "En preparacion" y el cambio se refleja por WS en <1s (DoD)',
    async () => {
      const pedidoId = await crearPedidoDePrueba(baseUrl);
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);
      const socket = conectar(token);

      try {
        await esperarEvento(socket, 'pedidos:snapshot');

        const inicio = Date.now();
        socket.emit('pedido:transicion', {
          pedidoId,
          nuevoEstado: 'EN_PREPARACION',
        });

        const actualizado = await esperarEvento<{
          id: string;
          estado: string;
        }>(socket, 'pedido:actualizado');
        const transcurrido = Date.now() - inicio;

        expect(actualizado.id).toBe(pedidoId);
        expect(actualizado.estado).toBe('EN_PREPARACION');
        expect(transcurrido).toBeLessThan(1000);
      } finally {
        socket.disconnect();
      }
    },
  );

  itConMozo(
    '[TC-I-KDS-005] KDS: reconexion (pedidos:sync) no pierde pedidos pendientes tras un corte',
    async () => {
      const pedidoId = await crearPedidoDePrueba(baseUrl);
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);

      // Primera conexion, simulando el cliente antes del corte.
      const socket1 = conectar(token);
      await esperarEvento(socket1, 'pedidos:snapshot');
      socket1.disconnect(); // simula el corte de red

      // Segunda conexion, simulando la reconexion automatica del cliente.
      const socket2 = conectar(token);
      try {
        const snapshot = await esperarEvento<Array<{ id: string }>>(
          socket2,
          'pedidos:snapshot',
        );
        expect(snapshot.some((p) => p.id === pedidoId)).toBe(true);

        // pedidos:sync explicito (el que dispara el cliente real tras
        // reconectar, ademas del snapshot automatico de handleConnection).
        socket2.emit('pedidos:sync');
        const snapshotSync = await esperarEvento<Array<{ id: string }>>(
          socket2,
          'pedidos:snapshot',
        );
        expect(snapshotSync.some((p) => p.id === pedidoId)).toBe(true);
      } finally {
        socket2.disconnect();
      }
    },
  );

  it('[TC-I-KDS-006] [Checklist seguridad] KDS: token real de COMENSAL es rechazado al conectar (no es rol de operacion del KDS)', async () => {
    const tokenComensal = await getComensalToken();
    const socket = conectar(tokenComensal);
    try {
      const errorPayload = await esperarEvento<{ message: string }>(
        socket,
        'error',
      );
      expect(errorPayload.message).toBe(
        'Rol no autorizado para acceder al KDS.',
      );
    } finally {
      socket.disconnect();
    }
  });
});
