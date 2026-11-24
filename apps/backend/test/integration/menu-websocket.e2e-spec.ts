import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { MenuGateway } from '../../src/menu/menu.gateway';

/**
 * BL-515: el canal en tiempo real de Gestión de Carta (namespace /menu)
 * exige el token de un Administrador y toma el tenant del token, nunca del
 * query string (el tenantId del QR es público).
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;

const TENANT_AJENO = '99999999-9999-4999-8999-999999999999';

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

/** tenant_id del token, sin verificar la firma (solo para armar el test). */
function tenantDelToken(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as { tenant_id: string };
  return payload.tenant_id;
}

/** Espera la conexión o el rechazo del handshake, con timeout. */
function resultadoDeConexion(
  socket: Socket,
  timeoutMs = 5000,
): Promise<{ conectado: boolean; mensaje?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timeout esperando la conexión a /menu')),
      timeoutMs,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve({ conectado: true });
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      resolve({ conectado: false, mensaje: err.message });
    });
  });
}

describe('Canal WebSocket de Gestión de Carta /menu (BL-515) - e2e', () => {
  let app: INestApplication;
  let wsUrl: string;
  const sockets: Socket[] = [];

  const itConAdmin = ADMIN_USER && ADMIN_PASS ? it : it.skip;
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
    wsUrl = `http://localhost:${port}/menu`;
  });

  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  function conectar(token?: string, tenantIdQuery?: string): Socket {
    const socket = io(wsUrl, {
      auth: token ? { token } : {},
      query: tenantIdQuery ? { tenantId: tenantIdQuery } : {},
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    sockets.push(socket);
    return socket;
  }

  it('[TC-I-230] /menu: rechaza la conexión sin token aunque mande un tenantId', async () => {
    const resultado = await resultadoDeConexion(
      conectar(undefined, TENANT_AJENO),
    );

    expect(resultado.conectado).toBe(false);
    expect(resultado.mensaje).toBe('Token no provisto en el handshake');
  });

  itConMozo(
    '[TC-I-231] /menu: rechaza un token válido de un rol que no es ADMIN',
    async () => {
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);

      const resultado = await resultadoDeConexion(conectar(token));

      expect(resultado.conectado).toBe(false);
      expect(resultado.mensaje).toBe('Rol no autorizado para este canal.');
    },
  );

  itConAdmin(
    '[TC-I-232] /menu: un ADMIN recibe los cambios de su tenant y no los del tenantId que manda en el query',
    async () => {
      const token = await getToken(ADMIN_USER as string, ADMIN_PASS as string);
      const tenantPropio = tenantDelToken(token);
      const socket = conectar(token, TENANT_AJENO);

      expect((await resultadoDeConexion(socket)).conectado).toBe(true);

      const recibidos: string[] = [];
      socket.on('menu:item:updated', (p: { itemId: string }) =>
        recibidos.push(p.itemId),
      );

      const gateway = app.get(MenuGateway);
      gateway.emitItemUpdated(TENANT_AJENO, {
        itemId: 'item-ajeno',
        disponible: false,
      });
      gateway.emitItemUpdated(tenantPropio, {
        itemId: 'item-propio',
        disponible: false,
      });

      await new Promise((r) => setTimeout(r, 500));
      expect(recibidos).toEqual(['item-propio']);
    },
  );
});
