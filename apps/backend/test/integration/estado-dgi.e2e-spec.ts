import 'dotenv/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { CfeEstadoDgi, Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import {
  CfeEmitidoConEstado,
  ConsultaEmitidos,
  SurtecClient,
} from '../../src/cfe/surtec.client';
import { EstadoDgiService } from '../../src/cfe/estado-dgi/estado-dgi.service';
import { fechaUruguay } from '../../src/cfe/estado-dgi/estado-dgi';
import { ComprobantesService } from '../../src/comprobantes/comprobantes.service';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-009 (BL-455): estado de los CFE ante la DGI y listado del
// administrador.
//
// Base, RLS y transacciones reales. Surtec es falso: la consulta de emitidos
// devuelve lo que arma cada test (no se llama a la API real). Los pedidos de
// prueba se crean ENTREGADOS: no aparecen en el KDS ni en cobros pendientes.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Surtec falso: responde la consulta con lo que tenga cargado. */
class SurtecFalso {
  emitidos: CfeEmitidoConEstado[] = [];
  consultas: ConsultaEmitidos[] = [];
  configurado(): boolean {
    return true;
  }
  consultarEmitidos(consulta: ConsultaEmitidos) {
    this.consultas.push(consulta);
    return Promise.resolve(this.emitidos);
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
  ) =>
    enTenant<{ id: string; ref: string; serie: string; numero: number }>(
      async (tx) => {
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
            proveedorRef: ref,
            idExterno: `bl-455-${randomUUID()}`,
            urlConsulta: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
            estadoDgi,
            fechaEmision,
            retencionHasta: new Date(fechaEmision.getTime() + 5 * 365 * DIA_MS),
          },
          select: { id: true, serie: true, numero: true },
        });
        return { ...creado, ref };
      },
    );

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
    surtec.emitidos = [];
    surtec.consultas = [];
  });

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-142] Estado DGI: el job guarda ACEPTADO (por id) y RECHAZADO (por serie y número) con su motivo; sin respuesta sigue PENDIENTE; los de más de 7 días y los de otro tenant no se tocan', async () => {
    const ahora = new Date();
    const aceptado = await comprobante(ahora);
    const rechazado = await comprobante(ahora);
    const sinRespuesta = await comprobante(ahora);
    const viejo = await comprobante(new Date(ahora.getTime() - 10 * DIA_MS));
    surtec.emitidos = [
      {
        id: aceptado.ref,
        serie: 'X',
        numero: 0,
        codigoDgi: 'AE',
        motivoDgi: null,
      },
      // Otro id: se empareja por serie y número.
      {
        id: 'id-desconocido',
        serie: rechazado.serie,
        numero: rechazado.numero,
        codigoDgi: 'BE',
        motivoDgi: 'Firma inválida',
      },
      {
        id: sinRespuesta.ref,
        serie: 'X',
        numero: 0,
        codigoDgi: null,
        motivoDgi: null,
      },
      {
        id: viejo.ref,
        serie: 'X',
        numero: 0,
        codigoDgi: 'AE',
        motivoDgi: null,
      },
    ];

    // Desde otro tenant: no ve estos comprobantes, no los toca.
    await estadoDgi.actualizarTenant(TENANT_B, 7, ahora);
    expect((await estadoDe(aceptado.id)).estadoDgi).toBe('PENDIENTE');

    const resumen = await estadoDgi.actualizarTenant(TENANT_ID, 7, ahora);

    const ultima = surtec.consultas.at(-1);
    expect(ultima).toMatchObject({
      rutEmisor: expect.stringMatching(/^\d{12}$/),
      fechaHasta: fechaUruguay(ahora),
    });
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
    surtec.emitidos = [
      {
        id: aceptado.ref,
        serie: 'X',
        numero: 0,
        codigoDgi: 'BE',
        motivoDgi: null,
      },
    ];
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
