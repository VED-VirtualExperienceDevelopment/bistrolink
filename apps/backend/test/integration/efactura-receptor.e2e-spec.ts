import 'dotenv/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { PagosService } from '../../src/pagos/pagos.service';
import { AnonimizarReceptorService } from '../../src/configuracion/anonimizar-receptor.service';
import { digitoVerificadorRut } from '../../src/plataforma/rut';
import { conPagoFalso } from './support/pago-falso';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-009 (BL-453): e-Factura con RUT y razón social del comensal.
//
// Todo real (base, RLS, transacciones y auditoría) salvo la pasarela y el
// CFE (conPagoFalso). Los pedidos de prueba terminan ENTREGADOS: no quedan
// en el KDS ni en cobros pendientes.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const ACTOR_PRUEBA = 'script:test-bl-453';
const RAZON_SOCIAL = 'Comensal de Prueba BL-453 SAS';

/**
 * Un RUT válido distinto en cada corrida: si una corrida anterior quedó a
 * medias, sus pedidos no cuentan en esta.
 */
function rutDePrueba(): string {
  for (;;) {
    const primeros = `21${String(randomInt(100000, 999999))}001`;
    const digito = digitoVerificadorRut(primeros);
    if (digito !== null) return `${primeros}${digito}`;
  }
}

describe('HU-009 (BL-453): e-Factura con RUT y razón social', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let pagos: PagosService;
  let anonimizar: AnonimizarReceptorService;
  const pedidosCreados: string[] = [];

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  const mesaVirtual = () =>
    enTenant<string>(async (tx) => {
      const mesa = await tx.mesa.findFirstOrThrow({
        where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
        select: { id: true },
      });
      return mesa.id;
    });

  /** Pedido para retirar de $ 590, en PENDIENTE_PAGO (lo paga el test). */
  const pedidoSinPagar = async () => {
    const mesaId = await mesaVirtual();
    const id = await enTenant<string>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-453-${randomUUID()}`,
          estado: 'PENDIENTE_PAGO',
          canal: 'WEB',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-453',
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
    pedidosCreados.push(id);
    return id;
  };

  /**
   * Pedido entregado de $ 1.220, pagado, con el receptor de la e-Factura y
   * su CFE (111) emitido.
   */
  const pedidoFacturado = async (rut: string) => {
    const mesaId = await mesaVirtual();
    const id = await enTenant<string>(async (tx) => {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId,
          idempotencyKey: `bl-453-${randomUUID()}`,
          estado: 'ENTREGADO',
          canal: 'WEB',
          receptorRut: rut,
          receptorRazonSocial: RAZON_SOCIAL,
          receptorConsentidoEn: new Date(),
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-453',
              precioUnitarioSnapshot: new Prisma.Decimal('1220'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('1220'),
            },
          },
          pagos: {
            create: {
              tenantId: TENANT_ID,
              idempotencyKey: `bl-453-pago-${randomUUID()}`,
              monto: new Prisma.Decimal('1220'),
              medioPago: 'MERCADOPAGO',
              estado: 'APROBADO',
            },
          },
        },
        select: { id: true, pagos: { select: { id: true } } },
      });
      const ahora = new Date();
      await tx.comprobanteFiscal.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId: pedido.id,
          pagoId: pedido.pagos[0].id,
          tipoCfe: '111',
          serie: 'A',
          numero: randomInt(1, 9_999_999),
          hashSha256: randomBytes(32).toString('base64'),
          proveedor: 'SURTEC',
          idExterno: `bl-453-${randomUUID()}`,
          fechaEmision: ahora,
          retencionHasta: new Date(ahora.getFullYear() + 5, 0, 1),
        },
      });
      return pedido.id;
    });
    pedidosCreados.push(id);
    return id;
  };

  /** Lo que no puede cambiar al anonimizar: CFE, pago y líneas. */
  const fiscalYMontos = (pedidoId: string) =>
    enTenant(async (tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          comprobantes: {
            select: {
              tipoCfe: true,
              serie: true,
              numero: true,
              hashSha256: true,
              idExterno: true,
              fechaEmision: true,
            },
          },
          pagos: { select: { monto: true, estado: true } },
          lineas: { select: { subtotal: true, nombreSnapshot: true } },
        },
      }),
    );

  const receptorDe = (pedidoId: string) =>
    enTenant(async (tx) =>
      tx.pedido.findUniqueOrThrow({
        where: { id: pedidoId },
        select: {
          receptorRut: true,
          receptorRazonSocial: true,
          receptorConsentidoEn: true,
          receptorAnonimizadoEn: true,
        },
      }),
    );

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await conPagoFalso(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    pagos = await app.resolve(PagosService);
    anonimizar = await app.resolve(AnonimizarReceptorService);
  }, 30000);

  afterAll(async () => {
    // Los pagados por el test quedan en cocina: se entregan.
    await enTenant((tx) =>
      tx.pedido.updateMany({
        where: { id: { in: pedidosCreados }, estado: { not: 'ENTREGADO' } },
        data: { estado: 'ENTREGADO' },
      }),
    ).catch(() => undefined);
    await app.close();
  }, 30000);

  it('[TC-I-140] e-Factura: con el aviso aceptado el pago guarda el RUT normalizado y la razón social en el pedido; sin aceptarlo no guarda nada', async () => {
    const rut = rutDePrueba();
    const conAviso = await pedidoSinPagar();
    const sinAviso = await pedidoSinPagar();

    await pagos.crear(TENANT_ID, {
      pedidoId: conAviso,
      idempotencyKey: `bl-453-${randomUUID()}`,
      medioPago: 'MERCADOPAGO',
      datosPasarela: {},
      receptorFiscal: {
        rut: `${rut.slice(0, 2)}.${rut.slice(2, 8)}.${rut.slice(8, 11)}-${rut[11]}`,
        razonSocial: `  ${RAZON_SOCIAL} `,
        consentimiento: true,
      },
    });
    await pagos.crear(TENANT_ID, {
      pedidoId: sinAviso,
      idempotencyKey: `bl-453-${randomUUID()}`,
      medioPago: 'MERCADOPAGO',
      datosPasarela: {},
      receptorFiscal: { rut, razonSocial: RAZON_SOCIAL, consentimiento: false },
    });

    expect(await receptorDe(conAviso)).toEqual({
      receptorRut: rut,
      receptorRazonSocial: RAZON_SOCIAL,
      receptorConsentidoEn: expect.any(Date),
      receptorAnonimizadoEn: null,
    });
    expect(await receptorDe(sinAviso)).toEqual({
      receptorRut: null,
      receptorRazonSocial: null,
      receptorConsentidoEn: null,
      receptorAnonimizadoEn: null,
    });
  });

  it('[TC-I-141] e-Factura: anonimizar un RUT borra el RUT y la razón social de sus pedidos y lo audita sin el RUT; CFE, pagos, montos y los pedidos de otro RUT quedan intactos', async () => {
    const rut = rutDePrueba();
    const otroRut = rutDePrueba();
    const primero = await pedidoFacturado(rut);
    const segundo = await pedidoFacturado(rut);
    const deOtro = await pedidoFacturado(otroRut);
    const antes = await Promise.all([primero, segundo].map(fiscalYMontos));
    // Margen por si el reloj de la base y el del test difieren un poco.
    const desde = new Date(Date.now() - 2000);

    const resultado = await anonimizar.anonimizar(TENANT_ID, rut, {
      id: ACTOR_PRUEBA,
    });

    expect(resultado).toEqual({ pedidos: 2 });
    for (const pedidoId of [primero, segundo]) {
      expect(await receptorDe(pedidoId)).toEqual({
        receptorRut: null,
        receptorRazonSocial: null,
        // Se conserva: es la prueba de que el comensal había consentido.
        receptorConsentidoEn: expect.any(Date),
        receptorAnonimizadoEn: expect.any(Date),
      });
    }
    expect(await Promise.all([primero, segundo].map(fiscalYMontos))).toEqual(
      antes,
    );
    expect((antes[0] as { comprobantes: unknown[] }).comprobantes).toEqual([
      expect.objectContaining({ tipoCfe: '111' }),
    ]);
    expect(await receptorDe(deOtro)).toMatchObject({
      receptorRut: otroRut,
      receptorRazonSocial: RAZON_SOCIAL,
      receptorAnonimizadoEn: null,
    });

    const auditoria = await enTenant<
      { entidad: string; detalle: Prisma.JsonValue }[]
    >((tx) =>
      tx.registroAuditoria.findMany({
        where: {
          accion: 'PEDIDO_RECEPTOR_ANONIMIZADO',
          actorKeycloakId: ACTOR_PRUEBA,
          createdAt: { gte: desde },
        },
        select: { entidad: true, detalle: true },
      }),
    );
    expect(auditoria).toEqual([{ entidad: 'pedido', detalle: { pedidos: 2 } }]);
    expect(JSON.stringify(auditoria)).not.toContain(rut);

    // Un segundo pedido de supresión del mismo RUT ya no encuentra nada.
    await expect(
      anonimizar.anonimizar(TENANT_ID, rut, { id: ACTOR_PRUEBA }),
    ).resolves.toEqual({ pedidos: 0 });
  });
});
