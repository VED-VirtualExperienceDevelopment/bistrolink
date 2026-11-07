import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { KdsGateway } from '../../src/pedidos/kds.gateway';
import { MenuGateway } from '../../src/menu/menu.gateway';
import { StockService } from '../../src/stock/stock.service';

// HU-015 (BL-120): stock de la jornada, alertas y descuento al confirmarse
// el pago (RF.04, RD.09, ADR 0009).
//
// Base, RLS y transacciones reales. Usa un ítem propio del test en la
// categoría Platos del tenant A (no toca los ítems del seed) y pedidos en
// PENDIENTE_PAGO cargados directo en la base; al terminar borra todo. Los
// gateways se espían: se prueba qué se avisa, no el socket.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const MOZO_USER = process.env.TEST_MOZO_USERNAME;
const MOZO_PASS = process.env.TEST_MOZO_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;
const itConAdmin = ADMIN_USER && ADMIN_PASS ? it : it.skip;
const itConMozoYCocina =
  MOZO_USER && MOZO_PASS && COCINA_USER && COCINA_PASS ? it : it.skip;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';
const MESA_A1 = '33333333-3333-3333-3333-333333333333';
const CATEGORIA_PLATOS = '44444444-4444-4444-4444-444444444444';

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

describe('HU-015 (BL-120): stock y alertas de stock bajo', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pedidos: PedidosService;
  let stock: StockService;
  let alertaStock: jest.SpyInstance;
  let itemMenu: jest.SpyInstance;
  let itemId: string;
  const pedidosCreados: string[] = [];

  const enTenant = <T>(
    tenantId: string,
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  /** Pone el stock del ítem del test. */
  const fijarStock = (stockActual: number, umbralAlerta = 5) =>
    enTenant(TENANT_A, (tx) =>
      tx.itemCarta.update({
        where: { id: itemId },
        data: {
          controlaStock: true,
          stockActual,
          umbralAlerta,
          disponible: stockActual > 0,
        },
      }),
    );

  const leerItem = () =>
    enTenant<{ stockActual: number; disponible: boolean }>(TENANT_A, (tx) =>
      tx.itemCarta.findUniqueOrThrow({
        where: { id: itemId },
        select: { stockActual: true, disponible: true },
      }),
    );

  /** Un pedido de la mesa 1 en PENDIENTE_PAGO con `cantidad` del ítem. */
  async function pedidoPendiente(cantidad: number): Promise<string> {
    const pedidoId = randomUUID();
    pedidosCreados.push(pedidoId);
    await enTenant(TENANT_A, async (tx) => {
      await tx.pedido.create({
        data: {
          id: pedidoId,
          tenantId: TENANT_A,
          restauranteId: RESTAURANTE_A,
          mesaId: MESA_A1,
          idempotencyKey: `hu-015-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'QR',
        },
      });
      await tx.lineaPedido.create({
        data: {
          tenantId: TENANT_A,
          pedidoId,
          itemCartaId: itemId,
          nombreSnapshot: 'Tarta del test de stock',
          precioUnitarioSnapshot: new Prisma.Decimal(300),
          cantidad,
          subtotal: new Prisma.Decimal(300 * cantidad),
        },
      });
    });
    return pedidoId;
  }

  /** Confirma el pago del pedido (como la tarjeta o el webhook) y avisa. */
  async function confirmarPago(pedidoId: string) {
    const confirmado = await enTenant<
      Awaited<ReturnType<PedidosService['confirmarPagoEnTx']>>
    >(TENANT_A, (tx) => pedidos.confirmarPagoEnTx(tx, TENANT_A, pedidoId));
    if (confirmado) pedidos.notificarPedidoConfirmado(TENANT_A, confirmado);
    return confirmado;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // El mismo ValidationPipe que main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    pedidos = await app.resolve(PedidosService);
    stock = await app.resolve(StockService);
    alertaStock = jest
      .spyOn(app.get(KdsGateway), 'emitirAlertaStock')
      .mockImplementation(() => undefined);
    itemMenu = jest
      .spyOn(app.get(MenuGateway), 'emitItemUpdated')
      .mockImplementation(() => undefined);
    // Lo demás que emite el gateway al confirmar un pago (KDS, comensal,
    // reportes) no interesa acá.
    for (const metodo of [
      'emitirNuevoPedido',
      'emitirActualizacionPedido',
      'emitirReportesActualizados',
      'emitirStockActualizado',
      // HU-042 (BL-464): aviso del estado de la cola.
      'avisarEstadoCola',
    ] as const) {
      jest
        .spyOn(app.get(KdsGateway), metodo)
        .mockImplementation(() => undefined);
    }

    const item = await enTenant<{ id: string }>(TENANT_A, (tx) =>
      tx.itemCarta.create({
        data: {
          tenantId: TENANT_A,
          categoriaId: CATEGORIA_PLATOS,
          nombre: `Tarta del test de stock ${randomUUID().slice(0, 8)}`,
          precio: new Prisma.Decimal(300),
          orden: 999,
        },
        select: { id: true },
      }),
    );
    itemId = item.id;
  }, 30000);

  beforeEach(() => {
    alertaStock.mockClear();
    itemMenu.mockClear();
  });

  afterAll(async () => {
    await enTenant(TENANT_A, async (tx) => {
      const deEstosPedidos = { pedidoId: { in: pedidosCreados } };
      await tx.pedidoEstadoHistorial.deleteMany({ where: deEstosPedidos });
      await tx.lineaPedido.deleteMany({ where: deEstosPedidos });
      await tx.pedido.deleteMany({ where: { id: { in: pedidosCreados } } });
      await tx.itemCarta.deleteMany({ where: { id: itemId } });
    }).catch(() => undefined);
    jest.restoreAllMocks();
    await app.close();
  }, 30000);

  itConAdmin(
    '[TC-I-153] HU-015: el administrador carga el stock de la jornada, lo ve en la lista y en las alertas cuando queda en el umbral',
    async () => {
      const token = await getToken(ADMIN_USER as string, ADMIN_PASS as string);
      const api = () => request(app.getHttpServer());

      const ajuste = await api()
        .patch('/admin/stock')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { itemId, controlaStock: true, stockActual: 4, umbralAlerta: 5 },
          ],
        })
        .expect(200);
      expect(ajuste.body).toEqual([
        expect.objectContaining({
          id: itemId,
          controlaStock: true,
          stockActual: 4,
          umbralAlerta: 5,
          disponible: true,
          alerta: 'STOCK_CRITICO',
        }),
      ]);

      const lista = await api()
        .get('/admin/stock')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(lista.body).toContainEqual(
        expect.objectContaining({ id: itemId, stockActual: 4 }),
      );

      const alertas = await api()
        .get('/admin/stock/alertas')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(alertas.body).toContainEqual({
        itemId,
        nombre: expect.any(String),
        stockActual: 4,
        umbralAlerta: 5,
        tipo: 'STOCK_CRITICO',
      });
    },
  );

  itConAdmin(
    '[TC-I-154] BL-121: un umbral o un stock negativo, un número con decimales o un dato de más dan 400',
    async () => {
      const token = await getToken(ADMIN_USER as string, ADMIN_PASS as string);
      for (const ajuste of [
        { itemId, umbralAlerta: -1 },
        { itemId, stockActual: -5 },
        { itemId, stockActual: 2.5 },
        { itemId, stockActual: 3, tenantId: TENANT_B },
      ]) {
        await request(app.getHttpServer())
          .patch('/admin/stock')
          .set('Authorization', `Bearer ${token}`)
          .send({ items: [ajuste] })
          .expect(400);
      }
    },
  );

  it('[TC-I-155] HU-015: sin token, las alertas y el ajuste responden 401', async () => {
    await request(app.getHttpServer()).get('/admin/stock/alertas').expect(401);
    await request(app.getHttpServer())
      .patch('/admin/stock')
      .send({ items: [{ itemId, stockActual: 10 }] })
      .expect(401);
  });

  itConMozoYCocina(
    '[TC-I-156] BL-122: el mozo y cocina no ven las alertas ni cambian el stock (403)',
    async () => {
      for (const [usuario, clave] of [
        [MOZO_USER, MOZO_PASS],
        [COCINA_USER, COCINA_PASS],
      ]) {
        const token = await getToken(usuario as string, clave as string);
        await request(app.getHttpServer())
          .get('/admin/stock/alertas')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
        await request(app.getHttpServer())
          .patch('/admin/stock')
          .set('Authorization', `Bearer ${token}`)
          .send({ items: [{ itemId, stockActual: 99 }] })
          .expect(403);
      }
    },
  );

  it('[TC-I-157] BL-121: al confirmarse el pago el stock se descuenta y, al cruzar el umbral, se avisa al administrador en menos de 5 s', async () => {
    await fijarStock(7, 5);
    const pedidoId = await pedidoPendiente(3);

    const inicio = Date.now();
    await confirmarPago(pedidoId);
    const demoraMs = Date.now() - inicio;

    expect(await leerItem()).toEqual({ stockActual: 4, disponible: true });
    expect(alertaStock).toHaveBeenCalledWith(TENANT_A, {
      itemId,
      nombre: expect.any(String),
      stockActual: 4,
      umbralAlerta: 5,
      tipo: 'STOCK_CRITICO',
    });
    expect(demoraMs).toBeLessThan(5000);
  });

  it('[TC-I-158] BL-121: al llegar a cero el ítem se deshabilita, se bloquea en la carta del comensal y no se puede volver a cobrar', async () => {
    await fijarStock(2, 5);
    const pedidoId = await pedidoPendiente(2);

    await confirmarPago(pedidoId);

    expect(await leerItem()).toEqual({ stockActual: 0, disponible: false });
    expect(alertaStock).toHaveBeenCalledWith(
      TENANT_A,
      expect.objectContaining({ itemId, stockActual: 0, tipo: 'AGOTADO' }),
    );
    expect(itemMenu).toHaveBeenCalledWith(TENANT_A, {
      itemId,
      disponible: false,
    });
    // Otro pedido con ese ítem ya no se puede cobrar (409 antes de cobrar).
    const otro = await pedidoPendiente(1);
    await expect(
      enTenant(TENANT_A, (tx) => pedidos.verificarStockEnTx(tx, otro)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('[TC-I-159] ADR 0009: dos pagos a la vez por la última unidad: el stock queda en 0, se avisa la venta sin stock y queda en la auditoría', async () => {
    await fijarStock(1, 5);
    const primero = await pedidoPendiente(1);
    const segundo = await pedidoPendiente(1);
    // Los dos pasaron la verificación antes de cobrar.
    await enTenant(TENANT_A, (tx) => pedidos.verificarStockEnTx(tx, primero));
    await enTenant(TENANT_A, (tx) => pedidos.verificarStockEnTx(tx, segundo));

    const resultados = await Promise.all([
      confirmarPago(primero),
      confirmarPago(segundo),
    ]);

    expect(resultados.every((r) => r !== null)).toBe(true);
    expect(await leerItem()).toEqual({ stockActual: 0, disponible: false });
    const sinStock = alertaStock.mock.calls
      .map(([, alerta]) => alerta)
      .filter((alerta) => alerta.vendidoSinStock);
    expect(sinStock).toEqual([
      expect.objectContaining({ itemId, stockActual: 0, vendidoSinStock: 1 }),
    ]);
    const auditoria = await enTenant<number>(TENANT_A, (tx) =>
      tx.registroAuditoria.count({
        where: {
          accion: 'CARTA_ITEM_VENDIDO_SIN_STOCK',
          entidadId: itemId,
        },
      }),
    );
    expect(auditoria).toBe(1);
  });

  it('[TC-I-160] BL-122: otro establecimiento no ve las alertas ni el stock del tenant A (RLS)', async () => {
    await fijarStock(0, 5);

    const alertasB = await stock.alertas(TENANT_B);
    const listaB = await stock.listar(TENANT_B);

    expect(alertasB.map((a) => a.itemId)).not.toContain(itemId);
    expect(listaB.map((i) => i.id)).not.toContain(itemId);
    expect((await stock.alertas(TENANT_A)).map((a) => a.itemId)).toContain(
      itemId,
    );
  });
});
