import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PagosService } from '../../src/pagos/pagos.service';
import { liberarMesaDelCobro } from '../../src/pagos/mesa-en-cobro';
import { asegurarClaveQr, tokenQrDeMesa } from './support/qr-mesa';
import { conPagoFalso } from './support/pago-falso';

// HU-017 (BL-60, testing en BL-61): apertura y cierre de la sesión de mesa.
//
// Usa una mesa propia (número 79 del tenant A), para no cerrar la mesa 1 del
// seed que usan los E2E y el resto de los tests. Al terminar queda LIBRE.
//
// El número queda FUERA del rango 80 a 99, que mesas-layout.e2e-spec.ts
// reserva para sus mesas y borra en cada corrida (BL-177). Antes era la 97:
// como al cerrar la mesa se cancelan pedidos y queda historial
// (pedido_estado_historial), mesas-layout no podía borrarla y fallaba
// cuando corría después de este archivo.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const NUMERO_MESA_TEST = 79;

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

describe('HU-017 (BL-60): sesión de mesa', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pagos: PagosService;
  let baseUrl: string;
  let mesaId: string;
  let qrToken: string;
  let tokenMozo: string;

  const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const mozo = (accion: 'abrir' | 'cerrar' | 'limpia') =>
    request(app.getHttpServer())
      .post(`/mesas/${mesaId}/${accion}`)
      .set('Authorization', `Bearer ${tokenMozo}`);

  const menuDelQr = () =>
    request(app.getHttpServer()).get(`/menu/qr/${qrToken}`);

  const tokenComensal = (sesionMesa: string) =>
    request(app.getHttpServer())
      .post('/auth/comensal/mesa')
      .send({ qrToken, sesionMesa });

  const crearPedido = (estado: string) =>
    enTenant<{ id: string }>((tx) =>
      tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-60-${estado}-${Date.now()}`,
          estado: estado as never,
          canal: 'QR',
        },
        select: { id: true },
      }),
    );

  // BL-509: pedido con monto (el cobro con tarjeta rechaza los de $ 0).
  const crearPedidoConMonto = () =>
    enTenant<{ id: string }>((tx) =>
      tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-509-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'QR',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-509',
              precioUnitarioSnapshot: new Prisma.Decimal('590'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('590'),
            },
          },
        },
        select: { id: true },
      }),
    );

  // BL-509: un cobro con tarjeta en curso de un pedido de la mesa.
  const crearPagoPendiente = (pedidoId: string) =>
    enTenant<{ id: string }>((tx) =>
      tx.pago.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId,
          idempotencyKey: `bl-509-${randomUUID()}`,
          monto: new Prisma.Decimal('590'),
          medioPago: 'MERCADOPAGO',
          estado: 'PENDIENTE',
        },
        select: { id: true },
      }),
    );

  const estadoMesa = () =>
    enTenant<{ estado: string }>((tx) =>
      tx.mesa.findUniqueOrThrow({
        where: { id: mesaId },
        select: { estado: true },
      }),
    ).then((m) => m.estado);

  // BL-509: deja la mesa abierta y cobrando, sin pasar por el mozo.
  const mesaCobrando = () =>
    enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: {
          estado: 'EN_PROCESO_DE_PAGO',
          sesionId: randomUUID(),
          sesionAbiertaEn: new Date(),
        },
      }),
    );

  // BL-509: termina un cobro como lo hacen el webhook o la conciliación: en
  // una transacción, primero el pago y después la mesa. Se usa RECHAZADO (y
  // no APROBADO) para no dejar pagos aprobados sin comprobante que levante
  // la conciliación de CFE.
  const rechazarCobro = (pagoId: string) =>
    enTenant<boolean>(async (tx) => {
      await tx.pago.update({
        where: { id: pagoId },
        data: { estado: 'RECHAZADO' },
      });
      return liberarMesaDelCobro(tx as PrismaClient, mesaId);
    });

  // BL-509: la mesa vuelve a LIBRE y sus pedidos y cobros de test se cierran.
  const dejarMesaLibre = (pedidoIds: string[]) =>
    enTenant(async (tx) => {
      await tx.pago.updateMany({
        where: { estado: 'PENDIENTE', pedido: { mesaId } },
        data: { estado: 'RECHAZADO' },
      });
      await tx.pedido.updateMany({
        where: { id: { in: pedidoIds } },
        data: { estado: 'CANCELADO' },
      });
      await tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      });
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
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://localhost:${port}`;

    tenantPrisma = await app.resolve(TenantPrismaService);
    pagos = await app.resolve(PagosService);

    // Mesa propia del test, siempre arrancando LIBRE y sin pedidos activos
    // de corridas anteriores.
    const mesa = await enTenant<{ id: string }>(async (tx) => {
      const existente = await tx.mesa.findFirst({
        where: { restauranteId: RESTAURANTE_ID, numero: NUMERO_MESA_TEST },
        select: { id: true },
      });
      if (existente) {
        // BL-509: un cobro PENDIENTE de una corrida que se cortó impediría
        // cerrar la mesa (409).
        await tx.pago.updateMany({
          where: { estado: 'PENDIENTE', pedido: { mesaId: existente.id } },
          data: { estado: 'RECHAZADO' },
        });
        await tx.pedido.updateMany({
          where: {
            mesaId: existente.id,
            estado: { notIn: ['ENTREGADO', 'CANCELADO'] },
          },
          data: { estado: 'CANCELADO' },
        });
        await tx.mesa.update({
          where: { id: existente.id },
          data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
        });
        return existente;
      }
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

    if (MOZO_USER && MOZO_PASS) {
      tokenMozo = await getToken(MOZO_USER, MOZO_PASS);
    }
  }, 30000);

  afterAll(async () => {
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-082] HU-017: con la mesa cerrada, el QR no abre la carta (410 MESA_CERRADA)', async () => {
    const res = await menuDelQr().expect(410);
    expect(res.body.codigo).toBe('MESA_CERRADA');
  });

  itConMozo(
    '[TC-I-083] HU-017: el mozo abre la mesa y el mapa se entera por WebSocket en menos de 1 s',
    async () => {
      const socket: Socket = io(baseUrl, {
        auth: { token: tokenMozo },
        transports: ['websocket'],
        forceNew: true,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.on('pedidos:snapshot', () => resolve());
          socket.on('error', (e: { message: string }) =>
            reject(new Error(e.message)),
          );
        });

        const evento = new Promise<{ mesaId: string; estado: string }>(
          (resolve) =>
            socket.on(
              'mesa:estado_actualizado',
              (payload: { mesaId: string; estado: string }) => {
                if (payload.mesaId === mesaId) resolve(payload);
              },
            ),
        );
        const inicio = Date.now();
        const res = await mozo('abrir').expect(200);
        const payload = await evento;

        expect(Date.now() - inicio).toBeLessThan(1000);
        expect(res.body.estado).toBe('OCUPADA');
        expect(payload.estado).toBe('OCUPADA');
      } finally {
        socket.disconnect();
      }

      // Ahora el QR abre la carta y trae la sesión, que sirve para el token.
      const menu = await menuDelQr().expect(200);
      expect(menu.body.sesionMesa).toEqual(expect.any(String));
      await tokenComensal(menu.body.sesionMesa).expect(200);
    },
  );

  itConMozo(
    '[TC-I-084] HU-017: cerrar con un pedido en preparación responde 409 y la mesa sigue abierta',
    async () => {
      const pedido = await crearPedido('EN_PREPARACION');

      const res = await mozo('cerrar').expect(409);
      expect(res.body.message).toContain('sin entregar');
      await menuDelQr().expect(200);

      await enTenant((tx) =>
        tx.pedido.update({
          where: { id: pedido.id },
          data: { estado: 'ENTREGADO' },
        }),
      );
    },
  );

  itConMozo(
    '[TC-I-085] HU-017: con todo entregado se cierra, se cancelan los pedidos sin pagar y el QR queda invalidado (410)',
    async () => {
      const { body: menu } = await menuDelQr().expect(200);
      const sinPagar = await crearPedido('PENDIENTE_PAGO');

      const res = await mozo('cerrar').expect(200);
      expect(res.body.mesa.estado).toBe('REQUIERE_LIMPIEZA');
      expect(res.body.pedidosCancelados).toBe(1);

      const cancelado = await enTenant<{ estado: string }>((tx) =>
        tx.pedido.findUniqueOrThrow({
          where: { id: sinPagar.id },
          select: { estado: true },
        }),
      );
      expect(cancelado.estado).toBe('CANCELADO');

      // El QR ya no abre la carta ni da token, aunque la página tenga la
      // sesión anterior.
      expect((await menuDelQr().expect(410)).body.codigo).toBe('MESA_CERRADA');
      expect(
        (await tokenComensal(menu.sesionMesa).expect(410)).body.codigo,
      ).toBe('MESA_CERRADA');
    },
  );

  itConMozo(
    '[TC-I-086] HU-017: al reabrir hay una sesión nueva; la de la página vieja ya no sirve',
    async () => {
      await mozo('abrir').expect(409); // requiere limpieza primero
      expect((await mozo('limpia').expect(200)).body.estado).toBe('LIBRE');
      await mozo('abrir').expect(200);

      const { body: menu } = await menuDelQr().expect(200);
      await tokenComensal(menu.sesionMesa).expect(200);
      const vieja = await tokenComensal(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ).expect(410);
      expect(vieja.body.codigo).toBe('SESION_VENCIDA');

      // Pedido con la sesión vieja: 410 (MesaQrGuard).
      const { body: auth } = await tokenComensal(menu.sesionMesa).expect(200);
      const pedido = await request(app.getHttpServer())
        .post('/pedidos')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .set('X-Mesa-Token', qrToken)
        .set('X-Mesa-Sesion', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
        .send({
          idempotencyKey: `bl-60-vieja-${Date.now()}`,
          items: [{ itemCartaId: ITEM_ID, cantidad: 1 }],
        })
        .expect(410);
      expect(pedido.body.codigo).toBe('SESION_VENCIDA');

      await mozo('cerrar').expect(200);
      await mozo('limpia').expect(200);
    },
  );

  itConMozo(
    '[TC-I-195] BL-509: cerrar con un cobro PENDIENTE responde 409 y no cancela el pedido que se está cobrando',
    async () => {
      await mozo('abrir').expect(200);
      const pedido = await crearPedidoConMonto();
      const pago = await crearPagoPendiente(pedido.id);
      // La mesa sigue OCUPADA (no EN_PROCESO_DE_PAGO), como quedaba con
      // los datos anteriores a BL-509: el cierre mira los pagos.

      const res = await mozo('cerrar').expect(409);
      expect(res.body.message).toContain('pago en curso');
      expect(await estadoMesa()).toBe('OCUPADA');
      const sigue = await enTenant<{ estado: string }>((tx) =>
        tx.pedido.findUniqueOrThrow({
          where: { id: pedido.id },
          select: { estado: true },
        }),
      );
      expect(sigue.estado).toBe('PENDIENTE_PAGO');

      // Termina el cobro: ahora sí se cierra.
      await enTenant((tx) =>
        tx.pago.update({
          where: { id: pago.id },
          data: { estado: 'RECHAZADO' },
        }),
      );
      await mozo('cerrar').expect(200);
      await mozo('limpia').expect(200);
    },
  );

  it('[TC-I-196] BL-509: con la mesa cerrada no se puede iniciar un cobro (409) y no se crea el pago', async () => {
    const pedido = await crearPedidoConMonto();
    try {
      await expect(
        pagos.crear(TENANT_ID, {
          pedidoId: pedido.id,
          idempotencyKey: `bl-509-${randomUUID()}`,
          medioPago: 'MERCADOPAGO',
          datosPasarela: {},
        }),
      ).rejects.toThrow('La mesa está cerrada: no se puede iniciar el cobro');

      const creados = await enTenant<number>((tx) =>
        tx.pago.count({ where: { pedidoId: pedido.id } }),
      );
      expect(creados).toBe(0);
      expect(await estadoMesa()).toBe('LIBRE');
    } finally {
      await dejarMesaLibre([pedido.id]);
    }
  });

  it('[TC-I-197] BL-509: con dos cobros en la mesa, sigue EN_PROCESO_DE_PAGO hasta que termina el último', async () => {
    const a = await crearPedidoConMonto();
    const b = await crearPedidoConMonto();
    try {
      const pagoA = await crearPagoPendiente(a.id);
      const pagoB = await crearPagoPendiente(b.id);
      await mesaCobrando();

      expect(await rechazarCobro(pagoA.id)).toBe(false);
      expect(await estadoMesa()).toBe('EN_PROCESO_DE_PAGO');

      expect(await rechazarCobro(pagoB.id)).toBe(true);
      expect(await estadoMesa()).toBe('OCUPADA');
    } finally {
      await dejarMesaLibre([a.id, b.id]);
    }
  });

  it('[TC-I-198] BL-509: dos cobros de la mesa que terminan a la vez la dejan OCUPADA (bloqueo de la mesa)', async () => {
    const a = await crearPedidoConMonto();
    const b = await crearPedidoConMonto();
    try {
      const pagoA = await crearPagoPendiente(a.id);
      const pagoB = await crearPagoPendiente(b.id);
      await mesaCobrando();

      // Sin el bloqueo, cada transacción vería el cobro de la otra todavía
      // PENDIENTE y la mesa quedaría EN_PROCESO_DE_PAGO sin cobros.
      const liberadas = await Promise.all([
        rechazarCobro(pagoA.id),
        rechazarCobro(pagoB.id),
      ]);

      expect(liberadas.filter(Boolean)).toHaveLength(1);
      expect(await estadoMesa()).toBe('OCUPADA');
    } finally {
      await dejarMesaLibre([a.id, b.id]);
    }
  });
});
