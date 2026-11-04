import 'dotenv/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import {
  CfeEmitido,
  SolicitudEmision,
  SurtecClient,
  SurtecError,
} from '../../src/cfe/surtec.client';
import { ConciliacionCfeService } from '../../src/cfe/conciliacion-cfe/conciliacion-cfe.service';
import { ComprobantesService } from '../../src/comprobantes/comprobantes.service';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-023 (BL-96): conciliación de CFE pendientes (pagos aprobados sin CFE).
//
// Base, RLS, transacciones y auditoría reales. Surtec es falso: emite o
// falla según el pago (no se llama a la API real). Los pedidos de prueba se
// crean ENTREGADOS: no aparecen en el KDS ni en cobros pendientes.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const ACTOR_PRUEBA = 'script:test-bl-96';
const MIN = 60_000;
const DIA_MS = 24 * 60 * MIN;
// Lote grande: en la base de CI puede haber otros pagos sin CFE de otros
// tests (se procesan primero, son más viejos).
const CONFIG = { dias: 3, maxIntentos: 10, lote: 500 };

/** Surtec falso: falla para los pagos de `caidos`, emite para el resto. */
class SurtecFalso {
  caidos = new Set<string>();
  emisiones: string[] = [];
  configurado(): boolean {
    return true;
  }
  emitirETicket(solicitud: SolicitudEmision): Promise<CfeEmitido> {
    this.emisiones.push(solicitud.idExterno);
    const pagoId = solicitud.idExterno.replace(/^bl-/, '');
    if (this.caidos.has(pagoId)) {
      return Promise.reject(
        new SurtecError('Surtec rechazó la emisión (HTTP 503): {}', 503),
      );
    }
    return Promise.resolve({
      id: String(randomInt(1, 2_000_000_000)),
      serie: 'ZY',
      numero: randomInt(1, 9_999_999),
      hash: randomBytes(32).toString('base64'),
      url: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
    });
  }
  emitirEFactura(solicitud: SolicitudEmision): Promise<CfeEmitido> {
    return this.emitirETicket(solicitud);
  }
}

describe('HU-023 (BL-96): conciliación de CFE pendientes', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let conciliacion: ConciliacionCfeService;
  let comprobantes: ComprobantesService;
  const surtec = new SurtecFalso();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
    tenantId = TENANT_ID,
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  /** Pedido entregado con un pago APROBADO sin CFE, de hace `antiguedadMs`. */
  const pagoSinCfe = (antiguedadMs: number) =>
    enTenant<string>(async (tx) => {
      const mesa = await tx.mesa.findFirstOrThrow({
        where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
        select: { id: true },
      });
      const fecha = new Date(Date.now() - antiguedadMs);
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: mesa.id,
          idempotencyKey: `bl-96-${randomUUID()}`,
          estado: 'ENTREGADO',
          canal: 'WEB',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-96',
              precioUnitarioSnapshot: new Prisma.Decimal('590'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('590'),
            },
          },
          pagos: {
            create: {
              tenantId: TENANT_ID,
              idempotencyKey: `bl-96-pago-${randomUUID()}`,
              monto: new Prisma.Decimal('590'),
              medioPago: 'MERCADOPAGO',
              estado: 'APROBADO',
              createdAt: fecha,
            },
          },
        },
        select: { pagos: { select: { id: true } } },
      });
      return pedido.pagos[0].id;
    });

  const estadoDelPago = (pagoId: string) =>
    enTenant<{
      cfeIntentos: number;
      cfeUltimoError: string | null;
      comprobantes: { tipoCfe: string; idExterno: string | null }[];
    }>((tx) =>
      tx.pago.findUniqueOrThrow({
        where: { id: pagoId },
        select: {
          cfeIntentos: true,
          cfeUltimoError: true,
          comprobantes: { select: { tipoCfe: true, idExterno: true } },
        },
      }),
    );

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SurtecClient)
      .useValue(surtec)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    conciliacion = await app.resolve(ConciliacionCfeService);
    comprobantes = await app.resolve(ComprobantesService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-161] Conciliación CFE: emite el CFE de un pago aprobado sin comprobante; si Surtec falla registra el intento y espera antes de reintentar; los de otro tenant y los de más de 3 días no se tocan', async () => {
    const pendiente = await pagoSinCfe(10 * MIN);
    const caido = await pagoSinCfe(10 * MIN);
    const viejo = await pagoSinCfe(5 * DIA_MS);
    surtec.caidos.add(caido);
    const ahora = new Date();

    // Desde otro tenant no se ven: no se emite nada de estos.
    await conciliacion.conciliarTenant(TENANT_B, CONFIG, ahora);
    expect(surtec.emisiones).not.toContain(`bl-${pendiente}`);

    await conciliacion.conciliarTenant(TENANT_ID, CONFIG, ahora);

    expect((await estadoDelPago(pendiente)).comprobantes).toEqual([
      { tipoCfe: '101', idExterno: `bl-${pendiente}` },
    ]);
    expect(await estadoDelPago(caido)).toEqual({
      cfeIntentos: 1,
      cfeUltimoError: 'Surtec rechazó la emisión (HTTP 503): {}',
      comprobantes: [],
    });
    expect(surtec.emisiones).not.toContain(`bl-${viejo}`);
    expect((await estadoDelPago(viejo)).cfeIntentos).toBe(0);

    // Enseguida no se reintenta (espera 5 min después del primer fallo).
    await conciliacion.conciliarTenant(TENANT_ID, CONFIG, ahora);
    expect(surtec.emisiones.filter((e) => e === `bl-${caido}`)).toHaveLength(1);

    // Pasados los 5 min, Surtec vuelve y se emite. El ya emitido no se repite.
    surtec.caidos.delete(caido);
    await conciliacion.conciliarTenant(
      TENANT_ID,
      CONFIG,
      new Date(Date.now() + 6 * MIN),
    );
    expect((await estadoDelPago(caido)).comprobantes).toHaveLength(1);
    expect(
      surtec.emisiones.filter((e) => e === `bl-${pendiente}`),
    ).toHaveLength(1);
  });

  it('[TC-I-162] Pendientes de emisión: el administrador ve los pagos sin CFE (los de más de 3 días requieren atención), los reintenta con auditoría y desde otro tenant no se ven (RLS)', async () => {
    const reciente = await pagoSinCfe(10 * MIN);
    const viejo = await pagoSinCfe(5 * DIA_MS);
    const desde = new Date(Date.now() - 2000);

    const todos = async (tenantId: string) => {
      const filas = [];
      for (let pagina = 1; ; pagina++) {
        const r = await comprobantes.consultarPendientes(tenantId, pagina);
        filas.push(...r.pendientes);
        if (!r.hayMas) return filas;
      }
    };
    const lista = await todos(TENANT_ID);
    expect(lista.find((p) => p.pagoId === reciente)).toMatchObject({
      monto: '590.00',
      mesa: null,
      canal: 'WEB',
      intentos: 0,
      requiereAtencion: false,
      proximoIntentoEn: expect.any(String),
    });
    expect(lista.find((p) => p.pagoId === viejo)).toMatchObject({
      requiereAtencion: true,
      proximoIntentoEn: null,
    });
    expect((await todos(TENANT_B)).map((p) => p.pagoId)).not.toContain(
      reciente,
    );

    // Desde otro tenant no se puede reintentar (no lo encuentra).
    await expect(
      comprobantes.reintentar(TENANT_B, viejo, { id: ACTOR_PRUEBA }),
    ).rejects.toMatchObject({ status: 404 });

    // «Reintentar ahora» también para el que requiere atención.
    const r = await comprobantes.reintentar(TENANT_ID, viejo, {
      id: ACTOR_PRUEBA,
    });
    expect(r).toMatchObject({ emitido: true, error: null });
    expect((await todos(TENANT_ID)).map((p) => p.pagoId)).not.toContain(viejo);
    await expect(
      comprobantes.reintentar(TENANT_ID, viejo, { id: ACTOR_PRUEBA }),
    ).rejects.toMatchObject({ status: 409 });

    // La auditoría se escribe aparte (sin esperar): se espera un poco.
    let auditoria: { entidadId: string | null; detalle: unknown }[] = [];
    for (let i = 0; i < 20 && auditoria.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      auditoria = await enTenant((tx) =>
        tx.registroAuditoria.findMany({
          where: {
            accion: 'PAGO_CFE_REINTENTADO',
            actorKeycloakId: ACTOR_PRUEBA,
            createdAt: { gte: desde },
          },
          select: { entidadId: true, detalle: true },
        }),
      );
    }
    expect(auditoria).toEqual([
      { entidadId: viejo, detalle: { resultado: 'EMITIDO' } },
    ]);
  });
});
