import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { MesasService } from '../../src/mesas/mesas.service';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { asegurarClaveQr, tokenQrDeMesa } from './support/qr-mesa';
import { conPagoFalso } from './support/pago-falso';

// BL-518: la pantalla del comensal se entera, sin recargar, de que el mozo
// cerró la mesa (WebSocket `mesa:seguir` → `mesa:sesion_cerrada`).
//
// Con Keycloak, base, RLS y WebSocket reales. Usa la mesa 78, propia de este
// test (fuera del 80 al 99, que son de mesas-layout.e2e-spec.ts); al
// terminar queda libre.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const NUMERO_MESA_TEST = 78;
const ACTOR_PRUEBA = 'script:test-bl-518';
const SIN_AVISO_MS = 800;

/** Espera un evento; falla si no llega a tiempo. */
function esperarEvento<T = unknown>(
  socket: Socket,
  evento: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No llegó «${evento}» en ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once(evento, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** true si el evento llega antes de `ms`. */
function llegaEvento(socket: Socket, evento: string, ms: number) {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      socket.off(evento, alLlegar);
      resolve(false);
    }, ms);
    function alLlegar() {
      clearTimeout(timer);
      resolve(true);
    }
    socket.once(evento, alLlegar);
  });
}

describe('BL-518: aviso de mesa cerrada al comensal', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let mesas: MesasService;
  let gateway: KdsGateway;
  let baseUrl: string;
  let mesaId: string;
  let qrToken: string;
  const sockets: Socket[] = [];

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Deja la mesa ocupada con una sesión nueva (y limpia si estaba cerrada). */
  const abrirMesa = async (): Promise<string> => {
    const sesionId = randomUUID();
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: {
          estado: 'OCUPADA',
          sesionId,
          sesionAbiertaEn: new Date(),
        },
      }),
    );
    return sesionId;
  };

  const tokenComensal = async (sesionMesa: string) => {
    const res = await request(app.getHttpServer())
      .post('/auth/comensal/mesa')
      .send({ qrToken, sesionMesa })
      .expect(200);
    return res.body.accessToken as string;
  };

  const conectar = async (token: string): Promise<Socket> => {
    const socket = io(baseUrl, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
    });
    sockets.push(socket);
    await esperarEvento(socket, 'connect');
    return socket;
  };

  /** `mesa:seguir` con ack: espera a que el backend responda. */
  const seguir = (socket: Socket, qr: string, sesionMesa: string) =>
    socket
      .timeout(5000)
      .emitWithAck('mesa:seguir', { qrToken: qr, sesionMesa }) as Promise<{
      siguiendo: boolean;
    }>;

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await app.listen(0); // puerto libre: conexiones WS reales
    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://localhost:${port}`;

    tenantPrisma = await app.resolve(TenantPrismaService);
    mesas = await app.resolve(MesasService);
    gateway = app.get(KdsGateway);

    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero: NUMERO_MESA_TEST },
        select: { id: true },
      });
      if (existente) return existente;
      return tx.mesa.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          numero: NUMERO_MESA_TEST,
          estado: 'LIBRE',
        },
        select: { id: true },
      });
    });
    mesaId = mesa.id;
    qrToken = await tokenQrDeMesa(app, TENANT_ID, mesaId);
  }, 30000);

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-206] Mesa cerrada: el comensal que sigue la sesión recibe mesa:sesion_cerrada cuando el mozo cierra la mesa; con la sesión vieja o un QR que no sirve, el aviso llega enseguida', async () => {
    const sesion = await abrirMesa();
    const socket = await conectar(await tokenComensal(sesion));

    await expect(seguir(socket, qrToken, sesion)).resolves.toEqual({
      siguiendo: true,
    });

    const aviso = esperarEvento<{ sesionMesa: string }>(
      socket,
      'mesa:sesion_cerrada',
    );
    await mesas.cerrarSesion(TENANT_ID, mesaId, ACTOR_PRUEBA);
    await expect(aviso).resolves.toEqual({ sesionMesa: sesion });

    // Ya cerrada: al volver a seguirla (por ejemplo, al reconectar), el aviso
    // llega enseguida.
    const otraVez = esperarEvento<{ sesionMesa: string }>(
      socket,
      'mesa:sesion_cerrada',
    );
    await expect(seguir(socket, qrToken, sesion)).resolves.toEqual({
      siguiendo: false,
    });
    await expect(otraVez).resolves.toEqual({ sesionMesa: sesion });

    // Un QR que no sirve: también.
    const conQrInvalido = esperarEvento(socket, 'mesa:sesion_cerrada');
    await expect(seguir(socket, 'no-es-un-qr', sesion)).resolves.toEqual({
      siguiendo: false,
    });
    await expect(conQrInvalido).resolves.toEqual({ sesionMesa: sesion });
  });

  it('[TC-I-207] Mesa cerrada: el aviso es por sesión; el grupo siguiente de la mesa no recibe el aviso del anterior y el personal no puede seguir la sesión', async () => {
    // Sesión anterior, cerrada.
    const anterior = await abrirMesa();
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    );

    // Grupo nuevo en la misma mesa.
    const actual = await abrirMesa();
    const socket = await conectar(await tokenComensal(actual));
    await expect(seguir(socket, qrToken, actual)).resolves.toEqual({
      siguiendo: true,
    });

    const llega = llegaEvento(socket, 'mesa:sesion_cerrada', SIN_AVISO_MS);
    gateway.emitirSesionCerrada(anterior);
    await expect(llega).resolves.toBe(false);

    // Con la sesión anterior, el comensal nuevo no se suma a esa sala.
    const avisoInmediato = esperarEvento(socket, 'mesa:sesion_cerrada');
    await expect(seguir(socket, qrToken, anterior)).resolves.toEqual({
      siguiendo: false,
    });
    await avisoInmediato;

    // La sesión actual sigue: al cerrarse, sí le llega.
    const aviso = esperarEvento(socket, 'mesa:sesion_cerrada');
    await mesas.cerrarSesion(TENANT_ID, mesaId, ACTOR_PRUEBA);
    await expect(aviso).resolves.toEqual({ sesionMesa: actual });
  });
});
