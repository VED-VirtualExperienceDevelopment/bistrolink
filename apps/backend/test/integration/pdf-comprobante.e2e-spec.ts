import 'dotenv/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { SurtecClient } from '../../src/cfe/surtec.client';
import { CfeService } from '../../src/cfe/cfe.service';
import { AlmacenCfe } from '../../src/cfe/respaldo-pdf/almacen-cfe';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-009 (BL-454): PDF del comprobante pedido a Surtec cuando todavía no
// hay copia en S3 (la copia la prueba respaldo-pdf-cfe.e2e-spec.ts, TC-I-176).
// Base y RLS reales; Surtec es falso y devuelve un PDF mínimo.
// El control de acceso del comensal (QR o token del pedido) lo prueban los
// unitarios de PagosController y los tests de PedidoAccesoGuard.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const PDF = Buffer.from('%PDF-1.4 prueba BL-454');

class SurtecFalso {
  pedidos: { rutEmisor: string; idSurtec: string }[] = [];
  configurado(): boolean {
    return true;
  }
  obtenerPdf(rutEmisor: string, idSurtec: string) {
    this.pedidos.push({ rutEmisor, idSurtec });
    return Promise.resolve({ contenido: PDF });
  }
}

describe('HU-009 (BL-454): PDF del comprobante', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let cfe: CfeService;
  const surtec = new SurtecFalso();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Pedido entregado y pagado; con `conCfe`, con su e-Factura de Surtec. */
  const pedido = (conCfe: boolean) =>
    enTenant<{ pedidoId: string; comprobanteId?: string; ref: string }>(
      async (tx) => {
        const mesa = await tx.mesa.findFirstOrThrow({
          where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
          select: { id: true },
        });
        const creado = await tx.pedido.create({
          data: {
            tenantId: TENANT_ID,
            restauranteId: RESTAURANTE_ID,
            mesaId: mesa.id,
            idempotencyKey: `bl-454-${randomUUID()}`,
            estado: 'ENTREGADO',
            canal: 'WEB',
            lineas: {
              create: {
                tenantId: TENANT_ID,
                itemCartaId: ITEM_ID,
                nombreSnapshot: 'Item de prueba BL-454',
                precioUnitarioSnapshot: new Prisma.Decimal('590'),
                cantidad: 1,
                subtotal: new Prisma.Decimal('590'),
              },
            },
            pagos: {
              create: {
                tenantId: TENANT_ID,
                idempotencyKey: `bl-454-pago-${randomUUID()}`,
                monto: new Prisma.Decimal('590'),
                medioPago: 'MERCADOPAGO',
                estado: 'APROBADO',
              },
            },
          },
          select: { id: true, pagos: { select: { id: true } } },
        });
        const ref = String(randomInt(1, 2_000_000_000));
        if (!conCfe) return { pedidoId: creado.id, ref };
        const ahora = new Date();
        const comprobante = await tx.comprobanteFiscal.create({
          data: {
            tenantId: TENANT_ID,
            pedidoId: creado.id,
            pagoId: creado.pagos[0].id,
            tipoCfe: '111',
            serie: 'ZX',
            numero: 49,
            hashSha256: randomBytes(32).toString('base64'),
            proveedor: 'SURTEC',
            proveedorRef: ref,
            idExterno: `bl-454-${randomUUID()}`,
            fechaEmision: ahora,
            retencionHasta: new Date(ahora.getFullYear() + 5, 0, 1),
          },
          select: { id: true },
        });
        return { pedidoId: creado.id, comprobanteId: comprobante.id, ref };
      },
    );

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SurtecClient)
      .useValue(surtec)
      // Sin S3_BUCKET_CFE: siempre se pide a Surtec.
      .overrideProvider(AlmacenCfe)
      .useValue({ configurado: () => false })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    cfe = await app.resolve(CfeService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-175] PDF del CFE: el comensal (por el pedido) y el admin (por el comprobante) reciben el PDF A4 que devuelve Surtec, pedido con el RUT del local y el id de Surtec; sin comprobante o desde otro tenant, 404', async () => {
    const conCfe = await pedido(true);
    const sinCfe = await pedido(false);

    const delPedido = await cfe.pdfDelPedido(TENANT_ID, conCfe.pedidoId);
    expect(delPedido).toEqual({
      nombreArchivo: 'e-Factura-ZX-0000049.pdf',
      mimeType: 'application/pdf',
      contenido: PDF.toString('base64'),
    });
    expect(surtec.pedidos.at(-1)).toEqual({
      rutEmisor: expect.stringMatching(/^\d{12}$/),
      idSurtec: conCfe.ref,
    });

    await expect(
      cfe.pdfDelComprobante(TENANT_ID, conCfe.comprobanteId!),
    ).resolves.toMatchObject({ nombreArchivo: 'e-Factura-ZX-0000049.pdf' });

    const pedidosASurtec = surtec.pedidos.length;
    await expect(
      cfe.pdfDelPedido(TENANT_ID, sinCfe.pedidoId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cfe.pdfDelPedido(TENANT_B, conCfe.pedidoId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      cfe.pdfDelComprobante(TENANT_B, conCfe.comprobanteId!),
    ).rejects.toMatchObject({ status: 404 });
    // Ninguno de esos llegó a Surtec.
    expect(surtec.pedidos).toHaveLength(pedidosASurtec);
  });
});
