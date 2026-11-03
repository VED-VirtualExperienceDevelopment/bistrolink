import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { PedidoCanal, PagoEstado, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { ResumenVentasService } from '../../src/reportes/resumen-ventas.service';
import { ReportesService } from '../../src/reportes/reportes.service';
import { FiltrosReportesDto } from '../../src/reportes/dto/filtros-reportes.dto';

// HU-012 (BL-108) y BL-219: dashboard de reportes.
//
// Base, RLS y resumen reales. Los datos de prueba están en días fijos de
// 2020 (en el tenant A del seed), lejos de los pedidos que crean los demás
// tests, y se borran al terminar. Las ventas se cargan directo en las
// tablas (sin pasarela) y el resumen se arma con ResumenVentasService, como
// lo hace el job.

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
const itConMozo = MOZO_USER && MOZO_PASS ? it : it.skip;
const itConCocina = COCINA_USER && COCINA_PASS ? it : it.skip;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';

// Día de las ventas de prueba (Montevideo, UTC-3) y la ventana en UTC que
// lo cubre.
const DIA = '2020-03-10';
const VENTANA_DIA = {
  desde: new Date('2020-03-10T00:00:00.000Z'),
  hasta: new Date('2020-03-12T00:00:00.000Z'),
};
// Tres sprints (6 semanas) de resumen para la prueba de rendimiento.
const PERF_DESDE = new Date('2020-01-01T00:00:00.000Z');
const PERF_DIAS = 42;

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

function filtros(valores: Partial<FiltrosReportesDto>): FiltrosReportesDto {
  return Object.assign(new FiltrosReportesDto(), valores);
}

describe('HU-012 (BL-108): reportes de ventas', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let resumen: ResumenVentasService;
  let reportes: ReportesService;
  let platoA: { id: string; nombre: string };
  let platoB: { id: string; nombre: string };
  let mesasFisicas: number;
  const pedidos: string[] = [];
  const sesiones: string[] = [];

  const enTenant = <T>(
    tenantId: string,
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  const consultaDelDia = `/admin/reportes?periodo=PERSONALIZADO&desde=${DIA}&hasta=${DIA}`;

  /** Un pedido con una línea y un pago, cargado directo en la base. */
  async function venta(datos: {
    canal: PedidoCanal;
    mesaId: string;
    plato: { id: string; nombre: string };
    cantidad: number;
    medioPago: string;
    estadoPago: PagoEstado;
    pagadoEn: string;
  }) {
    const restaurante = await enTenant<{ id: string }>(TENANT_A, (tx) =>
      tx.restaurante.findUniqueOrThrow({
        where: { tenantId: TENANT_A },
        select: { id: true },
      }),
    );
    const subtotal = new Prisma.Decimal(500 * datos.cantidad);
    const pedidoId = randomUUID();
    pedidos.push(pedidoId);
    await enTenant(TENANT_A, async (tx) => {
      await tx.pedido.create({
        data: {
          id: pedidoId,
          tenantId: TENANT_A,
          restauranteId: restaurante.id,
          mesaId: datos.mesaId,
          idempotencyKey: `hu-012-${randomUUID()}`,
          estado: 'ENTREGADO',
          canal: datos.canal,
        },
      });
      await tx.lineaPedido.create({
        data: {
          tenantId: TENANT_A,
          pedidoId,
          itemCartaId: datos.plato.id,
          nombreSnapshot: datos.plato.nombre,
          precioUnitarioSnapshot: new Prisma.Decimal(500),
          cantidad: datos.cantidad,
          subtotal,
        },
      });
      await tx.pago.create({
        data: {
          tenantId: TENANT_A,
          pedidoId,
          idempotencyKey: `hu-012-${randomUUID()}`,
          monto: subtotal,
          medioPago: datos.medioPago,
          estado: datos.estadoPago,
          createdAt: new Date(datos.pagadoEn),
        },
      });
    });
  }

  /** Borra los datos de prueba y su resumen. */
  async function limpiar() {
    await enTenant(TENANT_A, async (tx) => {
      const deEstosPedidos = { pedidoId: { in: pedidos } };
      await tx.pago.deleteMany({ where: deEstosPedidos });
      await tx.lineaPedido.deleteMany({ where: deEstosPedidos });
      await tx.pedido.deleteMany({ where: { id: { in: pedidos } } });
      await tx.sesionMesa.deleteMany({ where: { id: { in: sesiones } } });
      const hora = { gte: PERF_DESDE, lt: VENTANA_DIA.hasta };
      await tx.resumenVentasHora.deleteMany({ where: { hora } });
      await tx.resumenPlatosHora.deleteMany({ where: { hora } });
    });
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
    resumen = await app.resolve(ResumenVentasService);
    reportes = await app.resolve(ReportesService);

    const seed = await enTenant<{
      platos: { id: string; nombre: string }[];
      fisica: { id: string };
      virtual: { id: string };
      mesas: number;
    }>(TENANT_A, async (tx) => ({
      platos: await tx.itemCarta.findMany({
        take: 2,
        orderBy: { nombre: 'asc' },
        select: { id: true, nombre: true },
      }),
      fisica: await tx.mesa.findFirstOrThrow({
        where: { esVirtual: false },
        orderBy: { numero: 'asc' },
        select: { id: true },
      }),
      virtual: await tx.mesa.findFirstOrThrow({
        where: { esVirtual: true },
        select: { id: true },
      }),
      mesas: await tx.mesa.count({ where: { esVirtual: false } }),
    }));
    [platoA, platoB] = seed.platos;
    mesasFisicas = seed.mesas;
    await limpiar();

    // En el local (12 h de Montevideo): QR 2 × A y mozo 1 × B.
    await venta({
      canal: 'QR',
      mesaId: seed.fisica.id,
      plato: platoA,
      cantidad: 2,
      medioPago: 'MERCADOPAGO',
      estadoPago: 'APROBADO',
      pagadoEn: '2020-03-10T15:10:00.000Z',
    });
    await venta({
      canal: 'MOZO',
      mesaId: seed.fisica.id,
      plato: platoB,
      cantidad: 1,
      medioPago: 'EFECTIVO',
      estadoPago: 'APROBADO',
      pagadoEn: '2020-03-10T15:40:00.000Z',
    });
    // Fuera del local (20 h de Montevideo): Web 1 × A.
    await venta({
      canal: 'WEB',
      mesaId: seed.virtual.id,
      plato: platoA,
      cantidad: 1,
      medioPago: 'MERCADOPAGO',
      estadoPago: 'APROBADO',
      pagadoEn: '2020-03-10T23:30:00.000Z',
    });
    // No son ventas: un pago rechazado y uno reembolsado.
    await venta({
      canal: 'QR',
      mesaId: seed.fisica.id,
      plato: platoB,
      cantidad: 5,
      medioPago: 'MERCADOPAGO',
      estadoPago: 'RECHAZADO',
      pagadoEn: '2020-03-10T15:20:00.000Z',
    });
    await venta({
      canal: 'WEB',
      mesaId: seed.virtual.id,
      plato: platoB,
      cantidad: 3,
      medioPago: 'MERCADOPAGO',
      estadoPago: 'REEMBOLSADO',
      pagadoEn: '2020-03-10T16:00:00.000Z',
    });
    // Dos sesiones de mesa cerradas ese día: 30 y 90 minutos.
    await enTenant(TENANT_A, async (tx) => {
      const datos = [
        ['2020-03-10T15:00:00.000Z', '2020-03-10T15:30:00.000Z'],
        ['2020-03-10T18:00:00.000Z', '2020-03-10T19:30:00.000Z'],
      ].map(([abierta, cerrada]) => {
        const id = randomUUID();
        sesiones.push(id);
        return {
          id,
          tenantId: TENANT_A,
          mesaId: seed.fisica.id,
          abiertaEn: new Date(abierta),
          cerradaEn: new Date(cerrada),
        };
      });
      await tx.sesionMesa.createMany({ data: datos });
    });

    await resumen.recalcularVentana(TENANT_A, VENTANA_DIA);
  }, 30000);

  afterAll(async () => {
    await limpiar().catch(() => undefined);
    await app.close();
  }, 30000);

  itConAdmin(
    '[TC-I-140] HU-012: el administrador ve las ventas del día con todos los canales: totales, horas del local, platos, dentro y fuera del local y rotación',
    async () => {
      const token = await getToken(ADMIN_USER as string, ADMIN_PASS as string);

      const res = await request(app.getHttpServer())
        .get(consultaDelDia)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        rango: { desde: DIA, hasta: DIA, timezone: 'America/Montevideo' },
        canal: 'TODOS',
        resumen: {
          totalVendido: 2000,
          pedidos: 3,
          ticketPromedio: 666.67,
          anterior: { totalVendido: 0, pedidos: 0 },
        },
        porLugar: { local: 1500, web: 500, whatsapp: 0 },
        ventasPorHora: [
          { hora: 12, monto: 1500, pedidos: 2 },
          { hora: 20, monto: 500, pedidos: 1 },
        ],
        rotacionMesas: {
          aplica: true,
          sesiones: 2,
          mesas: mesasFisicas,
          ocupacionPromedioMin: 60,
        },
      });
      expect(res.body.platosMasPedidos.porCantidad).toEqual([
        {
          itemCartaId: platoA.id,
          nombre: platoA.nombre,
          cantidad: 3,
          recaudado: 1500,
        },
        {
          itemCartaId: platoB.id,
          nombre: platoB.nombre,
          cantidad: 1,
          recaudado: 500,
        },
      ]);
    },
  );

  itConAdmin(
    '[TC-I-141] HU-012: desglose por canal: en el local (QR y mozo), Web y WhatsApp; la rotación solo aplica en el local',
    async () => {
      const token = await getToken(ADMIN_USER as string, ADMIN_PASS as string);
      const pedir = (canal: string) =>
        request(app.getHttpServer())
          .get(`${consultaDelDia}&canal=${canal}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

      const local = (await pedir('LOCAL')).body;
      expect(local.resumen).toMatchObject({ totalVendido: 1500, pedidos: 2 });
      expect(local.ventasPorHora).toEqual([
        { hora: 12, monto: 1500, pedidos: 2 },
      ]);
      expect(local.rotacionMesas.aplica).toBe(true);

      const web = (await pedir('WEB')).body;
      expect(web.resumen).toMatchObject({ totalVendido: 500, pedidos: 1 });
      expect(web.ventasPorHora).toEqual([{ hora: 20, monto: 500, pedidos: 1 }]);
      expect(web.platosMasPedidos.porCantidad).toEqual([
        expect.objectContaining({ itemCartaId: platoA.id, cantidad: 1 }),
      ]);
      expect(web.rotacionMesas).toEqual({ aplica: false });
      // La comparación dentro y fuera del local no depende del filtro.
      expect(web.porLugar).toEqual({ local: 1500, web: 500, whatsapp: 0 });

      const whatsapp = (await pedir('WHATSAPP')).body;
      expect(whatsapp.resumen).toMatchObject({ totalVendido: 0, pedidos: 0 });
      expect(whatsapp.ventasPorHora).toEqual([]);
      expect(whatsapp.rotacionMesas).toEqual({ aplica: false });
    },
  );

  it('[TC-I-142] HU-012: sin token, 401', async () => {
    await request(app.getHttpServer()).get('/admin/reportes').expect(401);
  });

  itConMozo(
    '[TC-I-143] HU-012: el mozo no accede a los reportes (403)',
    async () => {
      const token = await getToken(MOZO_USER as string, MOZO_PASS as string);

      await request(app.getHttpServer())
        .get('/admin/reportes')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    },
  );

  itConCocina(
    '[TC-I-144] HU-012: cocina no accede a los reportes (403)',
    async () => {
      const token = await getToken(
        COCINA_USER as string,
        COCINA_PASS as string,
      );

      await request(app.getHttpServer())
        .get('/admin/reportes')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    },
  );

  itConAdmin(
    '[TC-I-145] HU-012: un rango en el futuro da un reporte vacío; filtros inválidos dan 400, nunca 5xx',
    async () => {
      const token = await getToken(ADMIN_USER as string, ADMIN_PASS as string);
      const pedir = (query: string) =>
        request(app.getHttpServer())
          .get(`/admin/reportes?${query}`)
          .set('Authorization', `Bearer ${token}`);

      const futuro = await pedir(
        'periodo=PERSONALIZADO&desde=2099-01-01&hasta=2099-01-31',
      ).expect(200);
      expect(futuro.body.resumen).toMatchObject({
        totalVendido: 0,
        pedidos: 0,
      });
      expect(futuro.body.ventasPorHora).toEqual([]);

      for (const query of [
        'periodo=PERSONALIZADO&desde=2020-03-10&hasta=2020-03-01',
        'periodo=PERSONALIZADO&desde=2019-01-01&hasta=2020-03-10',
        'periodo=PERSONALIZADO&desde=2020-02-30&hasta=2020-03-01',
        'periodo=PERSONALIZADO',
        'periodo=SIEMPRE',
        'canal=TELEFONO',
        'tenantId=b02579f2-2bb0-496b-abf2-33c494c93122',
      ]) {
        await pedir(query).expect(400);
      }
    },
  );

  it('[TC-I-146] BL-219: el resumen solo cuenta pagos aprobados y recalcularlo de nuevo deja lo mismo', async () => {
    const leer = () =>
      enTenant<unknown[]>(TENANT_A, (tx) =>
        tx.resumenVentasHora.findMany({
          where: { hora: { gte: VENTANA_DIA.desde, lt: VENTANA_DIA.hasta } },
          orderBy: [{ hora: 'asc' }, { canal: 'asc' }, { medioPago: 'asc' }],
          select: {
            hora: true,
            canal: true,
            medioPago: true,
            pedidos: true,
            monto: true,
          },
        }),
      );
    const antes = await leer();

    await resumen.recalcularVentana(TENANT_A, VENTANA_DIA);

    expect(await leer()).toEqual(antes);
    expect(
      antes
        .map((f: any) => `${f.canal}:${f.medioPago}:${Number(f.monto)}`)
        .sort(),
    ).toEqual([
      'MOZO:EFECTIVO:500',
      'QR:MERCADOPAGO:1000',
      'WEB:MERCADOPAGO:500',
    ]);
  });

  it('[TC-I-147] BL-110: otro establecimiento no ve el resumen ni las métricas del tenant A (RLS)', async () => {
    const filasDeA = await enTenant<number>(TENANT_B, (tx) =>
      tx.resumenVentasHora.count({
        where: {
          tenantId: TENANT_A,
          hora: { gte: VENTANA_DIA.desde, lt: VENTANA_DIA.hasta },
        },
      }),
    );
    expect(filasDeA).toBe(0);

    const reporteB = await reportes.obtener(
      TENANT_B,
      filtros({ periodo: 'PERSONALIZADO', desde: DIA, hasta: DIA }),
    );
    expect(reporteB.resumen.totalVendido).toBe(0);
    expect(reporteB.platosMasPedidos.porCantidad).toEqual([]);
    expect(reporteB.rotacionMesas).toMatchObject({ sesiones: 0 });
  });

  it('[TC-I-148] BL-109: el reporte del último mes, con 3 sprints de datos, responde en menos de 2 s', async () => {
    // 6 semanas × 12 horas de venta × 3 canales × 2 medios, y 20 platos por
    // hora y canal.
    const ventas: Prisma.ResumenVentasHoraCreateManyInput[] = [];
    const platos: Prisma.ResumenPlatosHoraCreateManyInput[] = [];
    for (let dia = 0; dia < PERF_DIAS; dia++) {
      for (let h = 14; h < 26; h++) {
        const hora = new Date(
          PERF_DESDE.getTime() + (dia * 24 + h) * 3_600_000,
        );
        for (const canal of ['QR', 'MOZO', 'WEB'] as const) {
          for (const medioPago of ['MERCADOPAGO', 'EFECTIVO']) {
            ventas.push({
              tenantId: TENANT_A,
              hora,
              canal,
              medioPago,
              pedidos: 3,
              monto: new Prisma.Decimal(1500),
            });
          }
          for (let p = 0; p < 20; p++) {
            platos.push({
              tenantId: TENANT_A,
              hora,
              canal,
              itemCartaId: `00000000-0000-4000-8000-${String(p).padStart(12, '0')}`,
              nombre: `Plato ${p}`,
              cantidad: p + 1,
              recaudado: new Prisma.Decimal(100 * (p + 1)),
            });
          }
        }
      }
    }
    await enTenant(TENANT_A, async (tx) => {
      await tx.resumenVentasHora.createMany({ data: ventas });
      await tx.resumenPlatosHora.createMany({ data: platos });
    });

    const inicio = performance.now();
    const reporte = await reportes.obtener(
      TENANT_A,
      filtros({
        periodo: 'PERSONALIZADO',
        desde: '2020-01-12',
        hasta: '2020-02-11',
      }),
    );
    const duracionMs = performance.now() - inicio;

    expect(reporte.resumen.pedidos).toBeGreaterThan(0);
    expect(reporte.platosMasPedidos.porCantidad).toHaveLength(10);
    expect(duracionMs).toBeLessThan(2000);
  }, 60000);
});
