import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Prisma } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { ReglasComplementoService } from '../../src/complementos/reglas-complemento.service';
import { LIMITE_COMPLEMENTOS_POR_QR } from '../../src/complementos/complementos-throttler.guard';
import { sumarAceptadasEnTx } from '../../src/complementos/metricas-sugerencia';
import { ReportesService } from '../../src/reportes/reportes.service';
import {
  asegurarClaveQr,
  sesionDeMesa,
  tokenQrDeMesa,
} from './support/qr-mesa';

/**
 * HU-046 (BL-552): reglas de complemento y endpoint público.
 *
 * Los pedidos (con su línea y su pago) se cargan directo en la base, como
 * en reportes.e2e-spec.ts, con platos de una categoría de prueba que se
 * borra al terminar. Las reglas se miran solo para esos platos: el
 * recálculo es del local entero, y otras suites cargan sus propios pedidos.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const OTRO_TENANT = '00000000-0000-4000-8000-000000000000';
const DIA_MS = 24 * 60 * 60 * 1000;

describe('HU-046: complementos (integración)', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let reglas: ReglasComplementoService;
  let reportes: ReportesService;
  let categoriaId: string;
  let mesaId: string;
  const ids: Record<string, string> = {};
  const pedidos: string[] = [];
  const ahora = new Date();

  const enTenant = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
    tenantPrisma.runInTenantContext(TENANT_ID, fn as never) as Promise<T>;

  /** Un pedido con un plato por línea y un pago, cargado directo. */
  async function pedido(
    platos: string[],
    opciones: {
      estadoPago?: 'APROBADO' | 'RECHAZADO';
      haceDias?: number;
      canal?: 'QR' | 'WEB';
      desdeSugerencia?: string[];
    } = {},
  ) {
    const pedidoId = randomUUID();
    pedidos.push(pedidoId);
    const pagadoEn = new Date(
      ahora.getTime() - (opciones.haceDias ?? 1) * DIA_MS,
    );
    await enTenant(async (tx) => {
      await tx.pedido.create({
        data: {
          id: pedidoId,
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `hu-046-${randomUUID()}`,
          estado: 'ENTREGADO',
          canal: opciones.canal ?? 'QR',
        },
      });
      await tx.lineaPedido.createMany({
        data: platos.map((nombre) => ({
          tenantId: TENANT_ID,
          pedidoId,
          itemCartaId: ids[nombre],
          nombreSnapshot: nombre,
          precioUnitarioSnapshot: new Prisma.Decimal(100),
          cantidad: 1,
          subtotal: new Prisma.Decimal(100),
          desdeSugerencia: opciones.desdeSugerencia?.includes(nombre) ?? false,
        })),
      });
      await tx.pago.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId,
          idempotencyKey: `hu-046-${randomUUID()}`,
          monto: new Prisma.Decimal(100 * platos.length),
          medioPago: 'MERCADO_PAGO',
          estado: opciones.estadoPago ?? 'APROBADO',
          createdAt: pagadoEn,
        },
      });
    });
    return pedidoId;
  }

  const complementosPorEnlace = (itemsEnPedido: unknown) =>
    request(app.getHttpServer())
      .post(
        `/menu/tenant/${TENANT_ID}/restaurante/${RESTAURANTE_ID}/complementos`,
      )
      .send({ itemsEnPedido });

  const editar = (nombre: string, data: Prisma.ItemCartaUpdateInput) =>
    enTenant((tx) => tx.itemCarta.update({ where: { id: ids[nombre] }, data }));

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    reglas = await app.resolve(ReglasComplementoService);
    reportes = await app.resolve(ReportesService);

    // Platos de prueba: [nombre, sugerible, contiene alcohol].
    const PLATOS: [string, boolean, boolean][] = [
      ['Milanesa', false, false],
      ['Flan', true, false],
      ['Vino', false, true],
      ['Agua', true, false],
      ['Cafe', true, false],
      ['Relleno', false, false],
    ];
    await enTenant(async (tx) => {
      mesaId = (
        await tx.mesa.findFirstOrThrow({
          where: { esVirtual: false },
          orderBy: { numero: 'asc' },
          select: { id: true },
        })
      ).id;
      const categoria = await tx.categoriaCarta.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          nombre: `HU-046 ${randomUUID().slice(0, 8)}`,
          orden: 9100,
        },
      });
      categoriaId = categoria.id;
      for (const [
        k,
        [nombre, sugerible, contieneAlcohol],
      ] of PLATOS.entries()) {
        const item = await tx.itemCarta.create({
          data: {
            tenantId: TENANT_ID,
            categoriaId,
            nombre,
            precio: '100.00',
            orden: k,
            sugerible,
            contieneAlcohol,
          },
        });
        ids[nombre] = item.id;
      }
    });

    // Milanesa → Flan: 6 pedidos (con vino), por encima de los umbrales.
    for (let i = 0; i < 6; i++) await pedido(['Milanesa', 'Flan', 'Vino']);
    // Milanesa → Agua: 4 aprobados y 3 rechazados (solo cuentan 4: < 5).
    for (let i = 0; i < 4; i++) await pedido(['Milanesa', 'Agua']);
    for (let i = 0; i < 3; i++)
      await pedido(['Milanesa', 'Agua'], { estadoPago: 'RECHAZADO' });
    // Milanesa → Café: 5, pero de hace 100 días (fuera de la ventana).
    for (let i = 0; i < 5; i++)
      await pedido(['Milanesa', 'Cafe'], { haceDias: 100 });
    // Pedidos sin estos pares, para que el flan no esté en casi todos.
    for (let i = 0; i < 5; i++) await pedido(['Relleno']);

    // Respaldo de popularidad (HU-045): el agua, con 12 unidades.
    await enTenant((tx) =>
      tx.resumenPlatosHora.create({
        data: {
          tenantId: TENANT_ID,
          // Hace 3 días: fuera de las horas que recalculan los cobros de
          // otras suites (HU-012).
          hora: new Date(
            Math.floor((ahora.getTime() - 3 * DIA_MS) / 3_600_000) * 3_600_000,
          ),
          canal: 'QR',
          itemCartaId: ids['Agua'],
          nombre: 'Agua',
          cantidad: 12,
          recaudado: '1200',
        },
      }),
    );
  }, 60000);

  afterAll(async () => {
    if (!app) return;
    if (categoriaId) {
      await enTenant(async (tx) => {
        const deEstosPedidos = { pedidoId: { in: pedidos } };
        await tx.pago.deleteMany({ where: deEstosPedidos });
        await tx.lineaPedido.deleteMany({ where: deEstosPedidos });
        await tx.pedido.deleteMany({ where: { id: { in: pedidos } } });
        await tx.resumenPlatosHora.deleteMany({
          where: { itemCartaId: { in: Object.values(ids) } },
        });
        // Las reglas de estos platos se borran en cascada con los platos.
        await tx.itemCarta.deleteMany({ where: { categoriaId } });
        await tx.categoriaCarta.delete({ where: { id: categoriaId } });
      });
    }
    await app.close();
  });

  it('[TC-I-227] HU-046: el recálculo deja solo las reglas que cumplen soporte, confianza y lift, con consecuente sugerible y sin alcohol, y otro local no las ve', async () => {
    const resultado = await reglas.recalcular(TENANT_ID, ahora);
    expect(resultado.reglas).toBeGreaterThanOrEqual(1);

    const deEstosPlatos = await enTenant((tx) =>
      tx.reglaComplemento.findMany({
        where: { antecedenteId: { in: Object.values(ids) } },
        orderBy: { antecedenteId: 'asc' },
      }),
    );
    // Solo el flan es consecuente: el agua no llega a 5 pedidos aprobados,
    // el café quedó fuera de los 90 días, el vino tiene alcohol y la
    // milanesa no es sugerible. Llevan al flan la milanesa y el vino.
    expect(
      deEstosPlatos.map((r) => [r.antecedenteId, r.consecuenteId]).sort(),
    ).toEqual(
      [
        [ids['Milanesa'], ids['Flan']],
        [ids['Vino'], ids['Flan']],
      ].sort(),
    );
    const regla = deEstosPlatos.find(
      (r) => r.antecedenteId === ids['Milanesa'],
    );
    expect(regla).toMatchObject({ tenantId: TENANT_ID, pedidosConAmbos: 6 });
    // Milanesa en 10 pedidos aprobados de la ventana: confianza 0,6.
    expect(regla?.confianza).toBeCloseTo(0.6);
    expect(regla?.lift).toBeGreaterThan(1);
    expect(regla?.soporte).toBeGreaterThan(0);

    // Idempotente: otra corrida deja lo mismo.
    await reglas.recalcular(TENANT_ID, ahora);
    const otraVez = await enTenant((tx) =>
      tx.reglaComplemento.findMany({
        where: { antecedenteId: { in: Object.values(ids) } },
      }),
    );
    expect(otraVez).toHaveLength(2);

    // Otro tenant no ve las reglas de este (RLS).
    const desdeOtro = await tenantPrisma.runInTenantContext(OTRO_TENANT, (tx) =>
      tx.reglaComplemento.findMany({
        where: { antecedenteId: ids['Milanesa'] },
      }),
    );
    expect(desdeOtro).toEqual([]);
  });

  it('[TC-I-228] HU-046: el endpoint sugiere hasta 2 platos por reglas o por popularidad, nunca con alcohol, agotado o ya en el pedido, sin datos de otros pedidos y con límite por minuto', async () => {
    await reglas.recalcular(TENANT_ID, ahora);

    // Por reglas: el flan, solo con los datos del plato.
    const porReglas = await complementosPorEnlace([ids['Milanesa']]).expect(
      HttpStatus.OK,
    );
    expect(porReglas.body.origen).toBe('reglas');
    expect(porReglas.body.sugerencias).toHaveLength(1);
    const [flan] = porReglas.body.sugerencias;
    expect(Object.keys(flan).sort()).toEqual([
      'descripcion',
      'id',
      'imagenUrl',
      'nombre',
      'precio',
    ]);
    expect(flan).toMatchObject({ id: ids['Flan'], nombre: 'Flan' });
    expect(Number(flan.precio)).toBe(100);

    // Con el flan ya en el pedido: no hay regla, va el más pedido (agua).
    const conFlan = await complementosPorEnlace([
      ids['Milanesa'],
      ids['Flan'],
    ]).expect(HttpStatus.OK);
    expect(conFlan.body.origen).toBe('popularidad');
    expect(conFlan.body.sugerencias.map((s: { id: string }) => s.id)).toEqual([
      ids['Agua'],
    ]);

    // Flan agotado: tampoco se sugiere.
    await editar('Flan', { disponible: false });
    const agotado = await complementosPorEnlace([ids['Milanesa']]).expect(
      HttpStatus.OK,
    );
    expect(
      agotado.body.sugerencias.map((s: { id: string }) => s.id),
    ).not.toContain(ids['Flan']);
    await editar('Flan', { disponible: true });

    // El vino (con alcohol) nunca aparece, ni pidiendo solo vino.
    const conVino = await complementosPorEnlace([ids['Vino']]).expect(
      HttpStatus.OK,
    );
    expect(
      conVino.body.sugerencias.map((s: { id: string }) => s.id),
    ).not.toContain(ids['Vino']);

    // Validaciones: sin platos, ids inválidos o un local de otro tenant.
    await complementosPorEnlace([]).expect(HttpStatus.BAD_REQUEST);
    await complementosPorEnlace(['no-es-un-id']).expect(HttpStatus.BAD_REQUEST);
    await request(app.getHttpServer())
      .post(
        `/menu/tenant/${TENANT_ID}/restaurante/${randomUUID()}/complementos`,
      )
      .send({ itemsEnPedido: [ids['Milanesa']] })
      .expect(HttpStatus.NOT_FOUND);

    // Por QR de la mesa: lo mismo, y con límite de pedidos por minuto.
    await sesionDeMesa(app, TENANT_ID, mesaId);
    const token = await tokenQrDeMesa(app, TENANT_ID, mesaId);
    const porQr = () =>
      request(app.getHttpServer())
        .post(`/menu/qr/${token}/complementos`)
        .send({ itemsEnPedido: [ids['Milanesa']] });
    const primera = await porQr().expect(HttpStatus.OK);
    expect(primera.body.sugerencias.map((s: { id: string }) => s.id)).toEqual([
      ids['Flan'],
    ]);
    for (let i = 1; i < LIMITE_COMPLEMENTOS_POR_QR; i++) {
      await porQr().expect(HttpStatus.OK);
    }
    await porQr().expect(HttpStatus.TOO_MANY_REQUESTS);

    // Un QR inventado: 404.
    await request(app.getHttpServer())
      .post('/menu/qr/inventado/complementos')
      .send({ itemsEnPedido: [ids['Milanesa']] })
      .expect(HttpStatus.NOT_FOUND);
  });

  it('[TC-I-229] HU-046: los contadores suman las sugerencias mostradas y las aceptadas por día y canal, sin datos del comensal, y Reportes muestra la tasa', async () => {
    await reglas.recalcular(TENANT_ID, ahora);
    const delPeriodo = async (canal: 'TODOS' | 'LOCAL' | 'WEB') =>
      (
        await reportes.obtener(
          TENANT_ID,
          { periodo: 'HOY', canal } as never,
          new Date(),
        )
      ).sugerencias;
    const antes = await delPeriodo('WEB');
    const antesLocal = await delPeriodo('LOCAL');

    // Una sugerencia mostrada por el enlace web (canal WEB).
    await complementosPorEnlace([ids['Milanesa']]).expect(HttpStatus.OK);
    // Sin sugerencias no se cuenta: con todo lo sugerible ya en el pedido.
    await editar('Agua', { sugerible: false });
    await editar('Cafe', { sugerible: false });
    const sinNada = await complementosPorEnlace([
      ids['Milanesa'],
      ids['Flan'],
    ]).expect(HttpStatus.OK);
    expect(sinNada.body.origen).toBe('ninguno');
    await editar('Agua', { sugerible: true });
    await editar('Cafe', { sugerible: true });

    // Un pedido web pagado con el flan agregado desde la sugerencia. El
    // relleno también viene marcado, pero no es sugerible: no cuenta.
    const pedidoId = await pedido(['Milanesa', 'Flan', 'Relleno'], {
      canal: 'WEB',
      desdeSugerencia: ['Flan', 'Relleno'],
    });
    await enTenant((tx) =>
      sumarAceptadasEnTx(tx as never, TENANT_ID, pedidoId),
    );

    const despues = await delPeriodo('WEB');
    expect(despues.mostradas).toBe(antes.mostradas + 1);
    expect(despues.aceptadas).toBe(antes.aceptadas + 1);
    expect(despues.tasaAceptacion).toBe(
      Math.round((despues.aceptadas / despues.mostradas) * 1000) / 10,
    );
    // El filtro de canal: en el local no cambió nada.
    expect(await delPeriodo('LOCAL')).toEqual(antesLocal);

    // La tabla solo tiene contadores: ni comensal ni pedido.
    const filas = await enTenant((tx) =>
      tx.metricaSugerenciaDia.findMany({ where: { canal: 'WEB' } }),
    );
    expect(filas.length).toBeGreaterThan(0);
    expect(Object.keys(filas[0]).sort()).toEqual([
      'aceptadas',
      'actualizadoEn',
      'canal',
      'dia',
      'mostradas',
      'tenantId',
    ]);

    // Otro tenant no ve los contadores de este (RLS).
    const desdeOtro = await tenantPrisma.runInTenantContext(OTRO_TENANT, (tx) =>
      tx.metricaSugerenciaDia.findMany(),
    );
    expect(desdeOtro).toEqual([]);
  });
});
