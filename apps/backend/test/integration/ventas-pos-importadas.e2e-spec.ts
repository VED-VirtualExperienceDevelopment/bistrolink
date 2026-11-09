import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { ImportacionVentasPosService } from '../../src/pos/importacion-ventas-pos.service';
import { ReportesService } from '../../src/reportes/reportes.service';
import { FiltrosReportesDto } from '../../src/reportes/dto/filtros-reportes.dto';
import { POS_ADAPTER, PosNoDisponibleError } from '../../src/pos/pos.adapter';
import { PosMockAdapter } from '../../src/pos/pos-mock.adapter';
import { conPagoFalso } from './support/pago-falso';

// HU-011 (BL-489): las ventas hechas directamente en el POS del local se
// traen al dashboard con el canal POS.
//
// El POS es el de prueba (PosMockAdapter), con una instancia del test para
// simular ventas de mostrador y "apagarlo". Todo lo demás es real: base, RLS,
// la tabla de ventas importadas, el resumen por hora y el reporte.
//
// Las ventas del test son de un día al azar (entre 2041 y 2065), a las
// 10:15 UTC, para que el resumen de esa hora tenga solo lo que crea el
// test. Activa la sincronización del tenant A durante el test y la vuelve a
// apagar al final.

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'bistrolink';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const DIA_MS = 24 * 60 * 60 * 1000;

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

/**
 * Un día al azar entre 2041 y 2065, a las 10:15 UTC (07:15 en Montevideo).
 * En el futuro a propósito: los otros tests de reportes usan días fijos del
 * pasado (por ejemplo, TC-I-145 espera 0 ventas del POS el 10/03/2020).
 */
function horaDePrueba(): Date {
  const dia = Date.UTC(2041, 0, 1) + Math.floor(Math.random() * 9000) * DIA_MS;
  return new Date(dia + (10 * 60 + 15) * 60 * 1000);
}

/** AAAA-MM-DD en Montevideo (la zona del tenant A). */
const diaLocal = (fecha: Date) =>
  fecha.toLocaleDateString('en-CA', { timeZone: 'America/Montevideo' });

describe('HU-011 (BL-489): ventas del POS del local en el dashboard', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let importacion: ImportacionVentasPosService;
  let reportes: ReportesService;
  const pos = new PosMockAdapter();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
    tenantId = TENANT_ID,
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  const sincronizacionHabilitada = (valor: boolean) =>
    enTenant((tx) =>
      tx.restaurante.update({
        where: { id: RESTAURANTE_ID },
        data: { posSincronizacionHabilitada: valor },
      }),
    );

  const importadas = (idsPos: string[], tenantId = TENANT_ID) =>
    enTenant<{ idPos: string; total: unknown; anulada: boolean }[]>(
      (tx) =>
        tx.ventaPosImportada.findMany({
          where: { idPos: { in: idsPos } },
          select: { idPos: true, total: true, anulada: true },
          orderBy: { idPos: 'asc' },
        }),
      tenantId,
    );

  /** La fila del resumen del canal POS para esa hora y medio de pago. */
  const resumenPos = (hora: Date, medioPago: string) =>
    enTenant<{ pedidos: number; monto: unknown } | null>((tx) =>
      tx.resumenVentasHora.findUnique({
        where: {
          tenantId_hora_canal_medioPago: {
            tenantId: TENANT_ID,
            hora: new Date(Math.floor(hora.getTime() / 3_600_000) * 3_600_000),
            canal: 'POS',
            medioPago,
          },
        },
        select: { pedidos: true, monto: true },
      }),
    );

  const reporteDelDia = (dia: Date, canal: FiltrosReportesDto['canal']) =>
    reportes.obtener(TENANT_ID, {
      periodo: 'PERSONALIZADO',
      canal,
      desde: diaLocal(dia),
      hasta: diaLocal(dia),
    });

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
    importacion = await app.resolve(ImportacionVentasPosService);
    reportes = await app.resolve(ReportesService);
    await sincronizacionHabilitada(true);
  });

  afterAll(async () => {
    await sincronizacionHabilitada(false);
    await app.close();
  });

  afterEach(() => {
    pos.disponible = true;
    jest.restoreAllMocks();
  });

  it('[TC-I-187] HU-011: las ventas hechas en el POS se importan una sola vez, sin las que mandó BistroLink, y suman al resumen con el canal POS; otro tenant no las ve (RLS)', async () => {
    const hora = horaDePrueba();
    const primera = pos.simularVentaPropia(TENANT_ID, {
      total: 350.5,
      medioPago: 'EFECTIVO',
      fecha: hora,
    });
    const segunda = pos.simularVentaPropia(TENANT_ID, {
      total: 149.5,
      medioPago: 'EFECTIVO',
      fecha: new Date(hora.getTime() + 20 * 60 * 1000),
    });
    // Una venta que mandó BistroLink (tiene la referencia del pedido).
    const { idPos: deBistroLink } = await pos.registrarVenta({
      referencia: randomUUID(),
      fecha: hora.toISOString(),
      moneda: 'UYU',
      total: 999,
      medioPago: 'MERCADOPAGO',
      mesa: 3,
      lineas: [],
    });

    const r = await importacion.importarTenant(TENANT_ID);
    expect(r.nuevas).toBeGreaterThanOrEqual(2);
    expect(r.omitidas).toBeGreaterThanOrEqual(1);

    const ids = [primera.idPos, segunda.idPos, deBistroLink];
    const guardadas = await importadas(ids);
    expect(guardadas.map((v) => v.idPos)).toEqual(
      [primera.idPos, segunda.idPos].sort(),
    );

    const resumen = await resumenPos(hora, 'EFECTIVO');
    expect(resumen?.pedidos).toBe(2);
    expect(Number(resumen?.monto)).toBe(500);

    // Otra vez: nada nuevo, nada duplicado.
    const otraVez = await importacion.importarTenant(TENANT_ID);
    expect(otraVez.nuevas).toBe(0);
    expect(await importadas(ids)).toHaveLength(2);
    expect((await resumenPos(hora, 'EFECTIVO'))?.pedidos).toBe(2);

    // El reporte del día, con el canal POS.
    const reporte = await reporteDelDia(hora, 'POS');
    expect(reporte.resumen.totalVendido).toBe(500);
    expect(reporte.resumen.pedidos).toBe(2);
    expect(reporte.porLugar.pos).toBe(500);
    expect(reporte.platosMasPedidos.porCantidad).toEqual([]);

    // RLS: el tenant B no las ve.
    expect(await importadas(ids, TENANT_B)).toEqual([]);
  });

  it('[TC-I-188] HU-011: una venta anulada en el POS deja de contar; con el POS caído no se pierde nada y se trae cuando vuelve', async () => {
    const hora = horaDePrueba();
    const venta = pos.simularVentaPropia(TENANT_ID, {
      total: 800,
      medioPago: 'CREDITO',
      fecha: hora,
    });
    const otra = pos.simularVentaPropia(TENANT_ID, {
      total: 200,
      medioPago: 'CREDITO',
      fecha: hora,
    });
    await importacion.importarTenant(TENANT_ID);
    expect((await resumenPos(hora, 'CREDITO'))?.pedidos).toBe(2);

    // Se anula en el POS, que después se cae.
    await pos.anularVenta(venta.idPos);
    pos.disponible = false;
    await expect(importacion.importarTenant(TENANT_ID)).rejects.toThrow(
      PosNoDisponibleError,
    );
    expect((await resumenPos(hora, 'CREDITO'))?.pedidos).toBe(2);

    // Vuelve: se trae la anulación.
    pos.disponible = true;
    const r = await importacion.importarTenant(TENANT_ID);
    expect(r.actualizadas).toBeGreaterThanOrEqual(1);

    const guardadas = await importadas([venta.idPos, otra.idPos]);
    expect(guardadas.find((v) => v.idPos === venta.idPos)?.anulada).toBe(true);
    const resumen = await resumenPos(hora, 'CREDITO');
    expect(resumen?.pedidos).toBe(1);
    expect(Number(resumen?.monto)).toBe(200);
    expect((await reporteDelDia(hora, 'POS')).resumen.totalVendido).toBe(200);
  });

  itConAdminYCocina(
    '[TC-I-189] HU-011: el administrador simula una venta en el POS de prueba, la trae y ve el resumen por HTTP; con la sincronización apagada, 409; Cocina recibe 403',
    async () => {
      const tokenAdmin = await getToken(ADMIN_USER!, ADMIN_PASS!);
      const tokenCocina = await getToken(COCINA_USER!, COCINA_PASS!);
      const servidor = app.getHttpServer();
      const comoAdmin = (r: request.Test) =>
        r.set('Authorization', `Bearer ${tokenAdmin}`);

      const antes = await comoAdmin(
        request(servidor).get('/admin/pos/ventas'),
      ).expect(200);

      const simulada = await comoAdmin(
        request(servidor).post('/admin/pos/ventas/simular'),
      )
        .send({ total: 123.45, medioPago: 'DEBITO' })
        .expect(201);
      expect(simulada.body).toMatchObject({ nuevas: 1 });
      expect(simulada.body.idPos).toMatch(/^MOCK-/);

      const despues = await comoAdmin(
        request(servidor).get('/admin/pos/ventas'),
      ).expect(200);
      expect(despues.body.ventas).toBe(antes.body.ventas + 1);
      expect(despues.body.total).toBeCloseTo(antes.body.total + 123.45, 2);
      expect(despues.body.ultimaVentaEn).toEqual(expect.any(String));

      await comoAdmin(request(servidor).post('/admin/pos/ventas/importar'))
        .expect(200)
        .expect((res) => expect(res.body.nuevas).toBe(0));

      await comoAdmin(request(servidor).post('/admin/pos/ventas/simular'))
        .send({ total: 0, medioPago: 'DEBITO' })
        .expect(400);

      await sincronizacionHabilitada(false);
      try {
        await comoAdmin(
          request(servidor).post('/admin/pos/ventas/importar'),
        ).expect(409);
      } finally {
        await sincronizacionHabilitada(true);
      }

      await request(servidor)
        .get('/admin/pos/ventas')
        .set('Authorization', `Bearer ${tokenCocina}`)
        .expect(403);
    },
  );
});
