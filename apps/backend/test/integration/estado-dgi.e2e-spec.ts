import 'dotenv/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CfeEstadoDgi, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { CfeEmitidoConEstado, SurtecClient } from '../../src/cfe/surtec.client';
import { EstadoDgiService } from '../../src/cfe/estado-dgi/estado-dgi.service';
import { fechaUruguay } from '../../src/cfe/estado-dgi/estado-dgi';
import { ComprobantesService } from '../../src/comprobantes/comprobantes.service';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-009 (BL-455): estado de los CFE ante la DGI y listado del
// administrador.
//
// Base, RLS y transacciones reales. Surtec es falso: la consulta de cada CFE
// (API v2, BL-471: por id de Surtec o por id_externo) devuelve lo que arma
// cada test (no se llama a la API real). Los pedidos de prueba se crean
// ENTREGADOS: no aparecen en el KDS ni en cobros pendientes.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Surtec falso: responde cada consulta con lo que tenga cargado. */
class SurtecFalso {
  /** Por id de Surtec. */
  porId = new Map<string, CfeEmitidoConEstado>();
  /** Por id_externo. */
  porIdExterno = new Map<string, CfeEmitidoConEstado>();
  /** RUT de cada consulta. */
  ruts: string[] = [];
  configurado(): boolean {
    return true;
  }
  consultarEmitido(rut: string, idSurtec: string) {
    this.ruts.push(rut);
    return Promise.resolve(this.porId.get(idSurtec) ?? null);
  }
  buscarEmitidoPorIdExterno(rut: string, idExterno: string) {
    this.ruts.push(rut);
    return Promise.resolve(this.porIdExterno.get(idExterno) ?? null);
  }
}

describe('HU-009 (BL-455): estado de los CFE ante la DGI', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let estadoDgi: EstadoDgiService;
  let comprobantes: ComprobantesService;
  const surtec = new SurtecFalso();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
    tenantId = TENANT_ID,
  ) => tenantPrisma.runInTenantContext(tenantId, fn) as Promise<T>;

  /** Pedido entregado y pagado de $ 1.220 con su CFE de Surtec. */
  const comprobante = (
    fechaEmision: Date,
    estadoDgi: CfeEstadoDgi = 'PENDIENTE',
    conIdSurtec = true,
  ) =>
    enTenant<{
      id: string;
      ref: string;
      idExterno: string;
      serie: string;
      numero: number;
    }>(async (tx) => {
      const mesa = await tx.mesa.findFirstOrThrow({
        where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
        select: { id: true },
      });
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: mesa.id,
          idempotencyKey: `bl-455-${randomUUID()}`,
          estado: 'ENTREGADO',
          canal: 'WEB',
          lineas: {
            create: {
              tenantId: TENANT_ID,
              itemCartaId: ITEM_ID,
              nombreSnapshot: 'Item de prueba BL-455',
              precioUnitarioSnapshot: new Prisma.Decimal('1220'),
              cantidad: 1,
              subtotal: new Prisma.Decimal('1220'),
            },
          },
          pagos: {
            create: {
              tenantId: TENANT_ID,
              idempotencyKey: `bl-455-pago-${randomUUID()}`,
              monto: new Prisma.Decimal('1220'),
              medioPago: 'MERCADOPAGO',
              estado: 'APROBADO',
            },
          },
        },
        select: { id: true, pagos: { select: { id: true } } },
      });
      const ref = `bl-455-${randomUUID()}`;
      const idExterno = `bl-455-${randomUUID()}`;
      const creado = await tx.comprobanteFiscal.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId: pedido.id,
          pagoId: pedido.pagos[0].id,
          tipoCfe: '101',
          // Serie de prueba: no choca con las de Surtec.
          serie: 'ZZ',
          numero: randomInt(1, 9_999_999),
          hashSha256: randomBytes(32).toString('base64'),
          proveedor: 'SURTEC',
          proveedorRef: conIdSurtec ? ref : null,
          idExterno,
          urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
          estadoDgi,
          fechaEmision,
          retencionHasta: new Date(fechaEmision.getTime() + 5 * 365 * DIA_MS),
        },
        select: { id: true, serie: true, numero: true },
      });
      return { ...creado, ref, idExterno };
    });

  const estadoDe = (id: string) =>
    enTenant<{
      estadoDgi: CfeEstadoDgi;
      estadoDgiMotivo: string | null;
      estadoDgiActualizadoEn: Date | null;
    }>((tx) =>
      tx.comprobanteFiscal.findUniqueOrThrow({
        where: { id },
        select: {
          estadoDgi: true,
          estadoDgiMotivo: true,
          estadoDgiActualizadoEn: true,
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
    estadoDgi = await app.resolve(EstadoDgiService);
    comprobantes = await app.resolve(ComprobantesService);
  }, 30000);

  beforeEach(() => {
    surtec.porId.clear();
    surtec.porIdExterno.clear();
    surtec.ruts = [];
  });

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-142] Estado DGI: el job consulta cada CFE en la API v2 de Surtec y guarda ACEPTADO (por id de Surtec) y RECHAZADO (por id_externo) con su motivo; sin respuesta sigue PENDIENTE; los de más de 7 días y los de otro tenant no se tocan', async () => {
    const ahora = new Date();
    const aceptado = await comprobante(ahora);
    const rechazado = await comprobante(ahora, 'PENDIENTE', false);
    const sinRespuesta = await comprobante(ahora);
    const viejo = await comprobante(new Date(ahora.getTime() - 10 * DIA_MS));
    const emitido = (
      id: string,
      codigoDgi: string | null,
      motivoDgi: string | null = null,
    ): CfeEmitidoConEstado => ({
      id,
      serie: 'X',
      numero: 0,
      codigoDgi,
      motivoDgi,
    });
    surtec.porId.set(aceptado.ref, emitido(aceptado.ref, 'AE'));
    // Sin id de Surtec: se busca por el id_externo.
    surtec.porIdExterno.set(
      rechazado.idExterno,
      emitido('otro-id', 'BE', 'Firma inválida'),
    );
    surtec.porId.set(sinRespuesta.ref, emitido(sinRespuesta.ref, 'NE'));
    surtec.porId.set(viejo.ref, emitido(viejo.ref, 'AE'));

    // Desde otro tenant: no ve estos comprobantes, no los toca.
    await estadoDgi.actualizarTenant(TENANT_B, 7, ahora);
    expect((await estadoDe(aceptado.id)).estadoDgi).toBe('PENDIENTE');

    const resumen = await estadoDgi.actualizarTenant(TENANT_ID, 7, ahora);

    // Cada consulta va con el RUT del establecimiento como emisor.
    expect(surtec.ruts.length).toBeGreaterThanOrEqual(3);
    expect(surtec.ruts.every((rut) => /^\d{12}$/.test(rut))).toBe(true);
    expect(resumen.actualizados).toBeGreaterThanOrEqual(2);
    expect(resumen.rechazados).toBeGreaterThanOrEqual(1);
    expect(await estadoDe(aceptado.id)).toEqual({
      estadoDgi: 'ACEPTADO',
      estadoDgiMotivo: null,
      estadoDgiActualizadoEn: expect.any(Date),
    });
    expect(await estadoDe(rechazado.id)).toMatchObject({
      estadoDgi: 'RECHAZADO',
      estadoDgiMotivo: 'Firma inválida',
    });
    expect((await estadoDe(sinRespuesta.id)).estadoDgi).toBe('PENDIENTE');
    expect((await estadoDe(viejo.id)).estadoDgi).toBe('PENDIENTE');

    // Una segunda corrida no vuelve a cambiar los definitivos.
    surtec.porId.set(aceptado.ref, emitido(aceptado.ref, 'BE'));
    await estadoDgi.actualizarTenant(TENANT_ID, 7, ahora);
    expect((await estadoDe(aceptado.id)).estadoDgi).toBe('ACEPTADO');
  });

  it('[TC-I-143] Comprobantes: el listado del administrador filtra por fecha y estado, muestra tipo, número, monto, estado y enlace de DGI, y desde otro tenant no se ve (RLS)', async () => {
    const ahora = new Date();
    const rechazado = await comprobante(ahora, 'RECHAZADO');

    const rechazados = await comprobantes.consultar(
      TENANT_ID,
      { estado: 'RECHAZADO' },
      ahora,
    );
    expect(rechazados.desde).toBe(fechaUruguay(ahora));
    expect(rechazados.comprobantes).toContainEqual({
      id: rechazado.id,
      fechaEmision: expect.any(String),
      tipoCfe: '101',
      serie: 'ZZ',
      numero: rechazado.numero,
      pedidoId: expect.any(String),
      mesa: null,
      canal: 'WEB',
      monto: '1220.00',
      estadoDgi: 'RECHAZADO',
      estadoDgiMotivo: null,
      urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
    });

    const ids = async (
      tenantId: string,
      filtros: Parameters<ComprobantesService['consultar']>[1],
    ) =>
      (await comprobantes.consultar(tenantId, filtros, ahora)).comprobantes.map(
        (c) => c.id,
      );
    expect(await ids(TENANT_ID, { estado: 'ACEPTADO' })).not.toContain(
      rechazado.id,
    );
    const ayer = fechaUruguay(new Date(ahora.getTime() - DIA_MS));
    expect(await ids(TENANT_ID, { desde: ayer, hasta: ayer })).not.toContain(
      rechazado.id,
    );
    expect(await ids(TENANT_B, {})).not.toContain(rechazado.id);
    expect(await ids(randomUUID(), {})).toEqual([]);
  });
});
