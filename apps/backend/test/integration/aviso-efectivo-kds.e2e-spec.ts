import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import {
  PedidosTransicionService,
  SolicitudEfectivoPendiente,
} from '../../src/pedidos/pedidos-transicion.service';
import { SolicitudEfectivoService } from '../../src/pagos/efectivo/solicitud-efectivo.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { conPagoFalso } from './support/pago-falso';
import { asegurarClaveQr } from './support/qr-mesa';

// BL-448: el aviso «Mesa N quiere pagar en efectivo» no se pierde. Un KDS
// que se conecta (o se reconecta) después de la solicitud la recibe en
// `llamados:snapshot`, y deja de recibirla cuando el mozo cobra.
//
// Todo es real (base, RLS, gateway) salvo la pasarela y el CFE
// (conPagoFalso). Usa una mesa propia (número 77 del tenant A, fuera del
// rango 80 a 99 de mesas-layout.e2e-spec.ts), que al terminar queda LIBRE.
// El test por WebSocket necesita el usuario mozo de Keycloak
// (TEST_MOZO_USERNAME / TEST_MOZO_PASSWORD), como los demás tests del KDS.
// BL-460: el que comprueba que Cocina no recibe los avisos necesita además el
// usuario de cocina (TEST_COCINA_USERNAME / TEST_COCINA_PASSWORD).

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
// Otro tenant: con RLS no tiene que ver las solicitudes del tenant A.
const TENANT_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 77;
const NOMBRE_ITEM = 'Item de prueba BL-448';
const ACTOR_PRUEBA = 'script:test-bl-448';

async function tokenDe(usuario?: string, clave?: string): Promise<string> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username: usuario ?? '',
        password: clave ?? '',
      }),
    },
  );
  if (!res.ok) throw new Error(`No se pudo obtener token: ${res.status}`);
  return (await res.json()).access_token as string;
}

const tokenMozo = () => tokenDe(MOZO_USER, MOZO_PASS);
const tokenCocina = () => tokenDe(COCINA_USER, COCINA_PASS);

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera (hasta 10 s) a que se cumpla la condición. */
async function hasta(condicion: () => boolean, que: string): Promise<void> {
  const limite = Date.now() + 10_000;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error(`No se cumplió: ${que}`);
    await esperar(50);
  }
}

/**
 * Conecta un KDS y anota los eventos de avisos que recibe (los llamados y el
 * efectivo). `listo` se cumple cuando llega el snapshot de pedidos, que el
 * servidor manda a todo el staff. `controles` anota los cambios de estado de
 * mesa, que van a toda la sala del establecimiento: prueban que ese KDS está
 * en el mismo establecimiento y que ya procesó lo que se emitió antes.
 */
function conectarKds(baseUrl: string, token: string) {
  const eventos: string[] = [];
  const controles: string[] = [];
  const socket: Socket = io(baseUrl, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  const listo = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('No llegó pedidos:snapshot'));
    }, 10_000);
    socket.on('error', (e: { message: string }) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error(e.message));
    });
    socket.on('pedidos:snapshot', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  for (const evento of [
    'llamados:snapshot',
    'llamado:nuevo',
    'llamado:resuelto',
  ]) {
    socket.on(evento, () => eventos.push(evento));
  }
  socket.on('mesa:estado_actualizado', () => controles.push('mesa'));
  return { socket, eventos, controles, listo };
}

/** Conecta un KDS y devuelve el primer `llamados:snapshot` que recibe. */
function snapshotDeLlamados(
  baseUrl: string,
  token: string,
): Promise<SolicitudEfectivoPendiente[]> {
  return new Promise((resolve, reject) => {
    const socket: Socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('No llegó llamados:snapshot'));
    }, 10_000);
    socket.on('error', (e: { message: string }) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error(e.message));
    });
    socket.on('llamados:snapshot', (snapshot: SolicitudEfectivoPendiente[]) => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(snapshot);
    });
  });
}

describe('BL-448: avisos de efectivo que no se pierden en el KDS', () => {
  let app: INestApplication;
  let baseUrl: string;
  let tenantPrisma: TenantPrismaService;
  let solicitudes: SolicitudEfectivoService;
  let cobros: CobroEfectivoService;
  let transicion: PedidosTransicionService;
  let gateway: KdsGateway;
  let mesaId: string;

  const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;
  const itConMozoYCocina =
    MOZO_USER && MOZO_PASS && COCINA_USER && COCINA_PASS ? it : it.skip;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Un pedido de la mesa de prueba esperando el pago, de $ 590. */
  const pedidoPendiente = () =>
    enTenant<string>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-448-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'QR',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: NOMBRE_ITEM,
              precioUnitarioSnapshot: new Prisma.Decimal('590'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('590'),
            },
          },
        },
        select: { id: true },
      });
      return pedido.id;
    });

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://localhost:${port}`;

    tenantPrisma = await app.resolve(TenantPrismaService);
    solicitudes = await app.resolve(SolicitudEfectivoService);
    cobros = await app.resolve(CobroEfectivoService);
    transicion = await app.resolve(PedidosTransicionService);
    gateway = app.get(KdsGateway);

    // Mesa propia del test, ocupada (con sesión, HU-017).
    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero: NUMERO_MESA_TEST },
        select: { id: true },
      });
      const datos = {
        estado: 'OCUPADA' as const,
        sesionId: randomUUID(),
        sesionAbiertaEn: new Date(),
      };
      if (existente) {
        return tx.mesa.update({
          where: { id: existente.id },
          data: datos,
          select: { id: true },
        });
      }
      return tx.mesa.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          numero: NUMERO_MESA_TEST,
          ...datos,
        },
        select: { id: true },
      });
    });
    mesaId = mesa.id;
  }, 30000);

  afterEach(async () => {
    // Ningún pedido de prueba queda esperando el pago.
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: {
          estado: 'PENDIENTE_PAGO',
          lineas: { some: { nombreSnapshot: NOMBRE_ITEM } },
        },
        data: { estado: 'CANCELADO' },
      }),
    );
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

  it('[TC-I-136] Efectivo: la solicitud pendiente aparece en el snapshot de avisos del tenant, no en el de otro tenant, y sale al cobrarse', async () => {
    const pedidoId = await pedidoPendiente();
    await solicitudes.solicitar(TENANT_ID, pedidoId, { pagaCon: '1000' });

    const pendientes = await transicion.listarSolicitudesEfectivo(TENANT_ID);
    expect(pendientes.find((s) => s.pedidoId === pedidoId)).toEqual({
      mesaId,
      mesaNumero: NUMERO_MESA_TEST,
      ts: expect.any(Number),
      motivo: 'PAGO_EFECTIVO',
      pedidoId,
      total: '590.00',
      pagaCon: '1000.00',
    });

    // RLS: el otro tenant no la ve.
    const ajenas = await transicion.listarSolicitudesEfectivo(TENANT_AJENO);
    expect(ajenas.some((s) => s.pedidoId === pedidoId)).toBe(false);

    // El mozo cobra: el pedido pasa a RECIBIDO y el aviso ya no está.
    await cobros.registrar(TENANT_ID, ACTOR_PRUEBA, {
      pedidoId,
      idempotencyKey: `bl-448-cobro-${randomUUID()}`,
      montoRecibido: '1000',
    });
    const despues = await transicion.listarSolicitudesEfectivo(TENANT_ID);
    expect(despues.some((s) => s.pedidoId === pedidoId)).toBe(false);
  });

  itConMozo(
    '[TC-I-137] Efectivo: un KDS que se conecta después de la solicitud recibe el aviso en llamados:snapshot',
    async () => {
      const pedidoId = await pedidoPendiente();
      // La solicitud se hace sin ningún KDS conectado: el evento en vivo se
      // pierde, como cuando el KDS se abre después.
      await solicitudes.solicitar(TENANT_ID, pedidoId, {});

      const snapshot = await snapshotDeLlamados(baseUrl, await tokenMozo());

      expect(snapshot.find((s) => s.pedidoId === pedidoId)).toMatchObject({
        mesaId,
        mesaNumero: NUMERO_MESA_TEST,
        motivo: 'PAGO_EFECTIVO',
        total: '590.00',
        pagaCon: null,
      });
    },
    30000,
  );

  itConMozoYCocina(
    '[TC-I-163] BL-460: el aviso de efectivo y los llamados de mesa llegan al Mozo, pero no a Cocina, ni al conectarse ni en vivo',
    async () => {
      const pedidoId = await pedidoPendiente();
      await solicitudes.solicitar(TENANT_ID, pedidoId, { pagaCon: '1000' });

      const mozo = conectarKds(baseUrl, await tokenMozo());
      const cocina = conectarKds(baseUrl, await tokenCocina());
      try {
        await Promise.all([mozo.listo, cocina.listo]);

        // Al conectarse: el Mozo recibe el efectivo pendiente en su snapshot.
        await hasta(
          () => mozo.eventos.includes('llamados:snapshot'),
          'el Mozo recibe llamados:snapshot',
        );

        // En vivo: un llamado de mesa y un aviso de efectivo.
        gateway.emitirLlamado(TENANT_ID, mesaId, NUMERO_MESA_TEST);
        gateway.emitirLlamado(TENANT_ID, mesaId, NUMERO_MESA_TEST, {
          pedidoId,
          total: '590.00',
          pagaCon: '1000.00',
        });
        await hasta(
          () => mozo.eventos.filter((e) => e === 'llamado:nuevo').length === 2,
          'el Mozo recibe los dos avisos en vivo',
        );

        // Control: un evento para todo el establecimiento, emitido después de
        // los avisos. Cuando Cocina lo recibe, está en el mismo establecimiento
        // y, como los eventos de un mismo cliente llegan en orden, ya habría
        // recibido antes cualquier aviso que se le hubiera mandado.
        gateway.emitirEstadoMesa(TENANT_ID, mesaId, MesaEstado.OCUPADA);
        await hasta(
          () => cocina.controles.length === 1,
          'Cocina recibe el evento de control',
        );

        expect(cocina.eventos).toEqual([]);
      } finally {
        mozo.socket.disconnect();
        cocina.socket.disconnect();
        // Saca la alerta del almacén en memoria, para no contaminar otros tests.
        gateway.emitirLlamadoResuelto(TENANT_ID, mesaId);
      }
    },
    30000,
  );
});
