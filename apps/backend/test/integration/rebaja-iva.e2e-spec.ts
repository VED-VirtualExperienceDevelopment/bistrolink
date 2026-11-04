import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PagosService } from '../../src/pagos/pagos.service';
import { puntosRebajaVigentes } from '../../src/cfe/rebaja-iva';
import { conPagoFalso } from './support/pago-falso';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-037 (BL-207): rebaja de IVA de la Ley 17.934 en el estado del pago que
// ve el comensal (GET /pedidos/:id/pagos). Todo real (base, RLS) salvo la
// pasarela y el CFE (conPagoFalso).
//
// Los pedidos se crean ya ENTREGADOS con su pago APROBADO: no aparecen en el
// KDS ni en cobros pendientes.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_DEMO_ID = '33333333-3333-3333-3333-333333333333';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';

describe('HU-037 (BL-207): rebaja de IVA por pago electrónico', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pagos: PagosService;

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Pedido entregado de $ 1.220 con un pago aprobado. */
  const pedidoPagado = (canal: 'QR' | 'WEB', medioPago: string) =>
    enTenant<string>(async (tx) => {
      const mesaId =
        canal === 'QR'
          ? MESA_DEMO_ID
          : (
              await tx.mesa.findFirstOrThrow({
                where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
                select: { id: true },
              })
            ).id;
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-207-${randomUUID()}`,
          estado: 'ENTREGADO',
          canal,
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-207',
              precioUnitarioSnapshot: new Prisma.Decimal('1220'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('1220'),
            },
          },
          pagos: {
            create: {
              tenantId: TENANT_ID,
              idempotencyKey: `bl-207-pago-${randomUUID()}`,
              monto: new Prisma.Decimal('1220'),
              medioPago,
              estado: 'APROBADO',
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
    tenantPrisma = await app.resolve(TenantPrismaService);
    pagos = await app.resolve(PagosService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-138] Rebaja IVA: pago con tarjeta de un consumo en el local informa total, reducción vigente, neto y leyenda; efectivo y para retirar no', async () => {
    const enElLocal = await pedidoPagado('QR', 'MERCADOPAGO');
    const enEfectivo = await pedidoPagado('QR', 'EFECTIVO');
    const paraRetirar = await pedidoPagado('WEB', 'MERCADOPAGO');

    const conRebaja = await pagos.consultar(TENANT_ID, enElLocal);
    expect(conRebaja.pago).toMatchObject({ monto: '1220.00' });
    // Hoy 9 puntos (Decreto 235/026); sin prórroga, 5 desde el 01/05/2027.
    const puntos = puntosRebajaVigentes(new Date());
    const reduccion = puntos === 9 ? '90.00' : '50.00';
    expect(conRebaja.rebajaIva).toEqual({
      ley: '17.934',
      puntos,
      totalSinReduccion: '1220.00',
      reduccion,
      neto: (1220 - Number(reduccion)).toFixed(2),
      leyenda: 'Reducción IVA Ley N° 17.934',
    });

    expect((await pagos.consultar(TENANT_ID, enEfectivo)).rebajaIva).toBeNull();
    expect(
      (await pagos.consultar(TENANT_ID, paraRetirar)).rebajaIva,
    ).toBeNull();
  });
});
