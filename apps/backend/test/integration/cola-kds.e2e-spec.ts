import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PedidoEstado } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import { PedidosTransicionService } from '../../src/pedidos/pedidos-transicion.service';
import { KdsGateway } from '../../src/pedidos/kds.gateway';

// HU-042 (BL-467, ADR 0010): cola del KDS y límite de pedidos en
// preparación, con base, RLS y transacciones reales.
//
// Lo que solo se puede probar contra PostgreSQL: el lock por tenant
// (pg_advisory_xact_lock) con dos transacciones en paralelo, el orden FIFO
// por encolado_en y el aislamiento entre tenants.
//
// Datos:
// - Pedidos propios del test en la mesa 1 del tenant A, sin líneas, cargados
//   en PENDIENTE_PAGO. Al terminar se borran con su historial.
// - Los pedidos del tenant A que ya estaban en RECIBIDO o EN_PREPARACION (seed
//   u otras suites) se apartan a LISTO_PARA_ENTREGAR mientras corre la suite,
//   para que no ocupen lugar ni pasen adelante en la cola, y se restauran al
//   final con su estado original.
// - La configuración de la cola del restaurante A se guarda al empezar y se
//   restaura al final.
// La suite corre con --runInBand: ninguna otra suite toca la base a la vez.

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_A = '22222222-2222-2222-2222-222222222222';
const MESA_A1 = '33333333-3333-3333-3333-333333333333';

const ESTADOS_DE_LA_COLA: PedidoEstado[] = [
  PedidoEstado.RECIBIDO,
  PedidoEstado.EN_PREPARACION,
];

const esperar = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('HU-042 (BL-467): cola del KDS con base real', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pedidos: PedidosService;
  let transicion: PedidosTransicionService;
  const pedidosCreados: string[] = [];
  let apartados: { id: string; estado: PedidoEstado }[] = [];
  let configuracionOriginal: {
    limitePedidosEnPreparacion: number | null;
    umbralAlertaCola: number;
    minutosPreparacionEstimados: number;
  };

  const enTenant = <T>(
    tenantId: string,
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  /** Límite de la cola del restaurante A (null = desactivada). */
  const fijarLimite = (limite: number | null) =>
    enTenant(TENANT_A, (tx) =>
      tx.restaurante.update({
        where: { tenantId: TENANT_A },
        data: { limitePedidosEnPreparacion: limite },
      }),
    );

  /** Un pedido de la mesa 1 en PENDIENTE_PAGO, sin líneas. */
  async function pedidoPendiente(): Promise<string> {
    const pedidoId = randomUUID();
    pedidosCreados.push(pedidoId);
    await enTenant(TENANT_A, (tx) =>
      tx.pedido.create({
        data: {
          id: pedidoId,
          tenantId: TENANT_A,
          restauranteId: RESTAURANTE_A,
          mesaId: MESA_A1,
          idempotencyKey: `hu-042-${randomUUID()}`,
          estado: PedidoEstado.PENDIENTE_PAGO,
          canal: 'QR',
        },
      }),
    );
    return pedidoId;
  }

  /** Confirma el pago en su propia transacción, como la pasarela o el webhook. */
  const confirmarPago = (pedidoId: string) =>
    enTenant(TENANT_A, (tx) =>
      pedidos.confirmarPagoEnTx(tx, TENANT_A, pedidoId),
    );

  const estadoDe = (pedidoId: string) =>
    enTenant<{ estado: PedidoEstado; encoladoEn: Date | null }>(
      TENANT_A,
      (tx) =>
        tx.pedido.findUniqueOrThrow({
          where: { id: pedidoId },
          select: { estado: true, encoladoEn: true },
        }),
    );

  /** Pedidos del test en preparación (los apartados no cuentan). */
  const enPreparacionDelTest = () =>
    enTenant<number>(TENANT_A, (tx) =>
      tx.pedido.count({
        where: {
          id: { in: pedidosCreados },
          estado: PedidoEstado.EN_PREPARACION,
        },
      }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    pedidos = await app.resolve(PedidosService);
    transicion = await app.resolve(PedidosTransicionService);
    // Se prueba la base, no el socket.
    for (const metodo of [
      'emitirNuevoPedido',
      'emitirActualizacionPedido',
      'emitirPedidoActualizado',
      'emitirReportesActualizados',
      'avisarEstadoCola',
    ] as const) {
      jest
        .spyOn(app.get(KdsGateway), metodo)
        .mockImplementation(() => undefined as never);
    }

    configuracionOriginal = await enTenant(TENANT_A, (tx) =>
      tx.restaurante.findUniqueOrThrow({
        where: { tenantId: TENANT_A },
        select: {
          limitePedidosEnPreparacion: true,
          umbralAlertaCola: true,
          minutosPreparacionEstimados: true,
        },
      }),
    );

    // Aparta los pedidos del tenant A que ocuparían lugar en la cola.
    apartados = await enTenant(TENANT_A, async (tx) => {
      const enCola = await tx.pedido.findMany({
        where: { tenantId: TENANT_A, estado: { in: ESTADOS_DE_LA_COLA } },
        select: { id: true, estado: true },
      });
      await tx.pedido.updateMany({
        where: { id: { in: enCola.map((p) => p.id) } },
        data: { estado: PedidoEstado.LISTO_PARA_ENTREGAR },
      });
      return enCola;
    });
  }, 30000);

  // Cada caso arranca con la cola vacía: los pedidos del caso anterior que
  // quedaron en la cola o en preparación se sacan (si no, el próximo caso los
  // vería como los más antiguos de la cola).
  afterEach(async () => {
    await enTenant(TENANT_A, async (tx) => {
      await tx.pedido.updateMany({
        where: {
          id: { in: pedidosCreados },
          estado: { in: ESTADOS_DE_LA_COLA },
        },
        data: { estado: PedidoEstado.ENTREGADO },
      });
      await tx.restaurante.update({
        where: { tenantId: TENANT_A },
        data: { limitePedidosEnPreparacion: null },
      });
    });
  });

  afterAll(async () => {
    await enTenant(TENANT_A, async (tx) => {
      await tx.pedidoEstadoHistorial.deleteMany({
        where: { pedidoId: { in: pedidosCreados } },
      });
      await tx.pedido.deleteMany({ where: { id: { in: pedidosCreados } } });
      for (const { id, estado } of apartados) {
        await tx.pedido.update({ where: { id }, data: { estado } });
      }
      await tx.restaurante.update({
        where: { tenantId: TENANT_A },
        data: configuracionOriginal,
      });
    }).catch(() => undefined);
    jest.restoreAllMocks();
    await app.close();
  }, 30000);

  it('[TC-I-164] HU-042: dos pagos aprobados a la vez con un solo lugar libre: solo uno pasa a preparación', async () => {
    await fijarLimite(1);
    const primero = await pedidoPendiente();
    const segundo = await pedidoPendiente();

    // Dos transacciones en paralelo, cada una con su conexión.
    await Promise.all([confirmarPago(primero), confirmarPago(segundo)]);

    const estados = [
      (await estadoDe(primero)).estado,
      (await estadoDe(segundo)).estado,
    ].sort();
    expect(estados).toEqual([
      PedidoEstado.EN_PREPARACION,
      PedidoEstado.RECIBIDO,
    ]);
    expect(await enPreparacionDelTest()).toBe(1);
  });

  it('[TC-I-165] HU-042: al marcar un pedido como listo pasa a preparación el más antiguo de la cola (FIFO)', async () => {
    const mozo = await enTenant<{ keycloakId: string } | null>(TENANT_A, (tx) =>
      tx.usuario.findFirst({
        where: { tenantId: TENANT_A, rol: 'MOZO', activo: true },
        select: { keycloakId: true },
      }),
    );
    expect(mozo).not.toBeNull();

    await fijarLimite(1);
    const enCocina = await pedidoPendiente();
    const primeroEnCola = await pedidoPendiente();
    const segundoEnCola = await pedidoPendiente();
    await confirmarPago(enCocina);
    await esperar(10);
    await confirmarPago(primeroEnCola);
    await esperar(10);
    await confirmarPago(segundoEnCola);
    expect((await estadoDe(enCocina)).estado).toBe(PedidoEstado.EN_PREPARACION);
    expect((await estadoDe(primeroEnCola)).estado).toBe(PedidoEstado.RECIBIDO);

    const { actualizado, promovidos } = await transicion.transicionar({
      tenantId: TENANT_A,
      keycloakId: mozo!.keycloakId,
      pedidoId: enCocina,
      nuevoEstado: PedidoEstado.LISTO_PARA_ENTREGAR,
    });

    expect(actualizado.estado).toBe(PedidoEstado.LISTO_PARA_ENTREGAR);
    expect(promovidos.map((p) => p.id)).toEqual([primeroEnCola]);
    expect((await estadoDe(primeroEnCola)).estado).toBe(
      PedidoEstado.EN_PREPARACION,
    );
    expect((await estadoDe(segundoEnCola)).estado).toBe(PedidoEstado.RECIBIDO);

    // La promoción automática deja historial sin usuario.
    const historial = await enTenant<{ usuarioId: string | null }[]>(
      TENANT_A,
      (tx) =>
        tx.pedidoEstadoHistorial.findMany({
          where: {
            pedidoId: primeroEnCola,
            estadoNuevo: PedidoEstado.EN_PREPARACION,
          },
          select: { usuarioId: true },
        }),
    );
    expect(historial).toEqual([{ usuarioId: null }]);
  });

  it('[TC-I-166] HU-042: con la cola desactivada el pedido queda en RECIBIDO, con su hora de llegada a cocina', async () => {
    await fijarLimite(null);
    const pedidoId = await pedidoPendiente();

    await confirmarPago(pedidoId);

    const { estado, encoladoEn } = await estadoDe(pedidoId);
    expect(estado).toBe(PedidoEstado.RECIBIDO);
    expect(encoladoEn).toBeInstanceOf(Date);
  });

  it('[TC-I-167] HU-042: el estado de la cola de un tenant nunca incluye pedidos de otro (RLS)', async () => {
    await fijarLimite(1);
    const enCocina = await pedidoPendiente();
    const enEspera = await pedidoPendiente();
    await confirmarPago(enCocina);
    await esperar(10);
    await confirmarPago(enEspera);

    const colaA = await transicion.estadoCola(TENANT_A);
    const colaB = await transicion.estadoCola(TENANT_B);

    expect(colaA.orden.map((p) => p.pedidoId)).toContain(enEspera);
    expect(colaB.orden.map((p) => p.pedidoId)).not.toContain(enEspera);
    expect(colaB.orden.map((p) => p.pedidoId)).not.toContain(enCocina);
  });
});
