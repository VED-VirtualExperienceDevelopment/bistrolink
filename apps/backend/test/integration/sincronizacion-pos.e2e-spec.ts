import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { CobroEfectivoService } from '../../src/pagos/efectivo/cobro-efectivo.service';
import { CancelacionPedidoService } from '../../src/pagos/cancelacion/cancelacion-pedido.service';
import { SincronizacionPosService } from '../../src/pos/sincronizacion-pos.service';
import { POS_ADAPTER, PosRechazoError } from '../../src/pos/pos.adapter';
import { PosMockAdapter } from '../../src/pos/pos-mock.adapter';
import { CancelarPedidoDto } from '../../src/pagos/cancelacion/cancelar-pedido.dto';
import { conPagoFalso } from './support/pago-falso';

// HU-011 (BL-488): las ventas cobradas van al POS del local.
//
// El POS es el de prueba (PosMockAdapter), con una instancia del test para
// poder "apagarlo" y mirar qué recibió. El CFE está apagado (conPagoFalso).
// Todo lo demás es real: base, RLS, la transacción del cobro (donde se
// encola la venta), el envío en segundo plano y el job.
//
// Usa una mesa propia (número 74 del tenant A). Activa el envío al POS del
// tenant A durante el test y lo vuelve a apagar al final.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const NUMERO_MESA_TEST = 74;
const ACTOR_PRUEBA = 'script:test-bl-488';
/** HU-011: la venta tiene que llegar al POS en menos de 5 s. */
const MAXIMO_MS = 5000;

const ADMIN_USER = process.env.TEST_ADMIN_USERNAME;
const ADMIN_PASS = process.env.TEST_ADMIN_PASSWORD;
const COCINA_USER = process.env.TEST_COCINA_USERNAME;
const COCINA_PASS = process.env.TEST_COCINA_PASSWORD;
const itConAdminYCocina =
  ADMIN_USER && ADMIN_PASS && COCINA_USER && COCINA_PASS ? it : it.skip;

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

interface FilaPos {
  id: string;
  tipo: string;
  estado: string;
  posRef: string | null;
  intentos: number;
  ultimoError: string | null;
}

describe('HU-011 (BL-488): ventas al POS del local', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let cobros: CobroEfectivoService;
  let cancelacion: CancelacionPedidoService;
  let sincronizacion: SincronizacionPosService;
  let mesaId: string;
  const pos = new PosMockAdapter();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
    tenantId = TENANT_ID,
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  const envioHabilitado = (valor: boolean) =>
    enTenant((tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { posSincronizacionHabilitada: valor },
      }),
    );

  /** Un pedido de la mesa de prueba esperando el pago, de $ 590. */
  const pedidoPendiente = () =>
    enTenant<string>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-488-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'QR',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-488',
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

  /** Cobra el pedido con el POS del local (BL-80), como el mozo. */
  const cobrar = async (pedidoId: string) => {
    await cobros.registrarPos(TENANT_ID, ACTOR_PRUEBA, {
      pedidoId,
      idempotencyKey: `bl-488-${randomUUID()}`,
      tarjeta: 'DEBITO',
      autorizacion: 'BL488A',
    });
  };

  const filas = (pedidoId: string, tenantId = TENANT_ID) =>
    enTenant<FilaPos[]>(
      (tx) =>
        tx.sincronizacionPos.findMany({
          where: { pedidoId },
          select: {
            id: true,
            tipo: true,
            estado: true,
            posRef: true,
            intentos: true,
            ultimoError: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
      tenantId,
    );

  /**
   * Espera (hasta 5 s) a que la fila de ese tipo llegue al estado y, si se
   * indica, a la cantidad de intentos: el envío corre en segundo plano.
   */
  const esperar = async (
    pedidoId: string,
    tipo: string,
    estado: string,
    intentos?: number,
  ): Promise<FilaPos> => {
    const limite = Date.now() + MAXIMO_MS;
    let fila: FilaPos | undefined;
    while (Date.now() < limite) {
      fila = (await filas(pedidoId)).find((f) => f.tipo === tipo);
      if (
        fila?.estado === estado &&
        (intentos === undefined || fila.intentos === intentos)
      ) {
        return fila;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `La ${tipo} del pedido no llegó a ${estado} en ${MAXIMO_MS} ms (está en ${fila?.estado ?? 'ninguna'}, ${fila?.intentos ?? 0} intentos)`,
    );
  };

  const estadoPedido = (pedidoId: string) =>
    enTenant<{ estado: string }>((tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: { estado: true },
      }),
    );

  beforeAll(async () => {
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    )
      .overrideProvider(POS_ADAPTER)
      .useValue(pos)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    tenantPrisma = await app.resolve(TenantPrismaService);
    cobros = await app.resolve(CobroEfectivoService);
    cancelacion = await app.resolve(CancelacionPedidoService);
    sincronizacion = await app.resolve(SincronizacionPosService);

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
    await envioHabilitado(true);
  }, 30000);

  afterEach(async () => {
    pos.disponible = true;
    // Ningún pedido de la mesa queda en cocina ni esperando el pago.
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: { mesaId, estado: { notIn: ['ENTREGADO', 'CANCELADO'] } },
        data: { estado: 'ENTREGADO' },
      }),
    );
  });

  afterAll(async () => {
    await envioHabilitado(false).catch(() => undefined);
    await enTenant((tx) =>
      tx.mesa.update({
        where: { id: mesaId },
        data: { estado: 'LIBRE', sesionId: null, sesionAbiertaEn: null },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-183] HU-011: un pedido cobrado queda encolado en la misma transacción y llega al POS en menos de 5 s, con el id del pedido como referencia; otro tenant no ve la sincronización', async () => {
    const pedidoId = await pedidoPendiente();
    const inicio = Date.now();

    await cobrar(pedidoId);

    const venta = await esperar(pedidoId, 'VENTA', 'ENVIADA');
    expect(Date.now() - inicio).toBeLessThan(MAXIMO_MS);
    const enElPos = pos
      .ventasRegistradas()
      .find((v) => v.venta.referencia === pedidoId);
    expect(enElPos).toBeDefined();
    expect(venta).toMatchObject({
      posRef: enElPos!.idPos,
      intentos: 1,
      ultimoError: null,
    });
    expect(enElPos!.venta).toMatchObject({
      moneda: 'UYU',
      total: 590,
      medioPago: 'POS_DEBITO',
      mesa: NUMERO_MESA_TEST,
      lineas: [
        {
          descripcion: 'Item de prueba BL-488',
          cantidad: 1,
          precioUnitario: 590,
          subtotal: 590,
        },
      ],
    });

    // RLS: el tenant B no ve la fila.
    expect(await filas(pedidoId, TENANT_B)).toEqual([]);
  });

  it('[TC-I-184] HU-011: con el POS caído, el pedido se cobra y pasa a cocina igual, la venta queda pendiente con el error y el job la manda cuando el POS vuelve', async () => {
    pos.disponible = false;
    const pedidoId = await pedidoPendiente();

    await cobrar(pedidoId);

    // El intento inmediato falla: sigue pendiente, con el motivo.
    const pendiente = await esperar(pedidoId, 'VENTA', 'PENDIENTE', 1);
    expect(pendiente.ultimoError).toBe('El POS de prueba está fuera de línea');
    // El pedido no cambió por la falla (rollback de la sincronización, no del cobro).
    expect((await estadoPedido(pedidoId)).estado).not.toBe('PENDIENTE_PAGO');

    // El POS vuelve y corre el job (como si hubiera pasado la espera).
    pos.disponible = true;
    const resumen = await sincronizacion.sincronizarTenant(
      TENANT_ID,
      { lote: 50 },
      new Date(Date.now() + 60 * 60 * 1000),
    );
    expect(resumen.enviados).toBeGreaterThanOrEqual(1);
    const enviada = (await filas(pedidoId))[0];
    expect(enviada).toMatchObject({ estado: 'ENVIADA', intentos: 2 });
    expect(
      pos.ventasRegistradas().some((v) => v.venta.referencia === pedidoId),
    ).toBe(true);
  });

  it('[TC-I-185] HU-011: al cancelar un pedido ya enviado se anula la venta en el POS; si todavía no se había mandado, se descarta sin anular nada', async () => {
    const dto = {
      motivo: 'RECLAMO_CLIENTE',
      devolucionManualConfirmada: true,
    } as CancelarPedidoDto;

    // 1. Enviado al POS y después cancelado: anulación en el POS.
    const enviado = await pedidoPendiente();
    await cobrar(enviado);
    const venta = await esperar(enviado, 'VENTA', 'ENVIADA');
    await cancelacion.cancelar(TENANT_ID, ACTOR_PRUEBA, enviado, dto);
    await esperar(enviado, 'ANULACION', 'ENVIADA');
    expect(
      pos.ventasRegistradas().find((v) => v.idPos === venta.posRef)?.anulada,
    ).toBe(true);

    // 2. Cobrado con el POS caído y cancelado antes de mandarse: descartada.
    pos.disponible = false;
    const sinMandar = await pedidoPendiente();
    await cobrar(sinMandar);
    await esperar(sinMandar, 'VENTA', 'PENDIENTE', 1);
    await cancelacion.cancelar(TENANT_ID, ACTOR_PRUEBA, sinMandar, dto);
    pos.disponible = true;

    const resultado = await filas(sinMandar);
    expect(resultado).toEqual([
      expect.objectContaining({ tipo: 'VENTA', estado: 'DESCARTADA' }),
    ]);
    expect(
      pos.ventasRegistradas().some((v) => v.venta.referencia === sinMandar),
    ).toBe(false);
  });

  itConAdminYCocina(
    '[TC-I-186] HU-011: el administrador lista las ventas del POS, reintenta una con error y activa el envío por HTTP; Cocina recibe 403',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER!, ADMIN_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const servidor = app.getHttpServer();

      // Una venta que el POS rechazó (queda con error).
      const rechazar = jest
        .spyOn(pos, 'registrarVenta')
        .mockRejectedValueOnce(
          new PosRechazoError(
            'El POS rechazó registrar la venta (HTTP 422)',
            422,
          ),
        );
      const pedidoId = await pedidoPendiente();
      await cobrar(pedidoId);
      const fila = await esperar(pedidoId, 'VENTA', 'ERROR');
      rechazar.mockRestore();
      expect(fila.ultimoError).toBe(
        'El POS rechazó registrar la venta (HTTP 422)',
      );

      const lista = await request(servidor)
        .get('/admin/pos/sincronizaciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(lista.body).toMatchObject({ habilitada: true, adaptador: 'mock' });
      expect(
        lista.body.sincronizaciones.find(
          (s: { id: string }) => s.id === fila.id,
        ),
      ).toMatchObject({ tipo: 'VENTA', total: 590, mesa: NUMERO_MESA_TEST });

      const reintento = await request(servidor)
        .post(`/admin/pos/sincronizaciones/${fila.id}/reintentar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);
      expect(reintento.body).toEqual({
        id: fila.id,
        estado: 'ENVIADA',
        ultimoError: null,
      });

      // Ya está en el POS: reintentar de nuevo es 409.
      await request(servidor)
        .post(`/admin/pos/sincronizaciones/${fila.id}/reintentar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(409);

      await request(servidor)
        .patch('/admin/pos/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ habilitada: 'si' })
        .expect(400);
      await request(servidor)
        .patch('/admin/pos/configuracion')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ habilitada: true })
        .expect(200, { habilitada: true });

      await request(servidor)
        .get('/admin/pos/sincronizaciones')
        .set('Authorization', `Bearer ${tokenCocina}`)
        .expect(403);
    },
  );
});
