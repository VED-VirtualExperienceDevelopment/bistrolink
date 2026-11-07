import 'dotenv/config';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { SurtecClient } from '../../src/cfe/surtec.client';
import { CfeService } from '../../src/cfe/cfe.service';
import { AlmacenCfe, sha256Hex } from '../../src/cfe/respaldo-pdf/almacen-cfe';
import { RespaldoPdfService } from '../../src/cfe/respaldo-pdf/respaldo-pdf.service';
import { asegurarClaveQr } from './support/qr-mesa';

// HU-009 (BL-454): copia del PDF de cada CFE en S3, con su SHA-256, y
// descarga desde esa copia. Base y RLS reales; Surtec y S3 son falsos (S3 en
// memoria), así el test no necesita credenciales ni un bucket.

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_B = 'b02579f2-2bb0-496b-abf2-33c494c93122';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const ITEM_ID = '55555555-5555-5555-5555-555555555555';
const PDF = Buffer.from('%PDF-1.4 prueba BL-454 respaldo');
const MINUTO = 60_000;

class SurtecFalso {
  pedidos: string[] = [];
  fallar = new Set<string>();
  configurado(): boolean {
    return true;
  }
  obtenerPdf(_rutEmisor: string, idSurtec: string) {
    this.pedidos.push(idSurtec);
    if (this.fallar.has(idSurtec)) {
      return Promise.reject(new Error('Surtec no responde'));
    }
    return Promise.resolve({ contenido: PDF });
  }
}

class S3EnMemoria {
  objetos = new Map<string, Buffer>();
  configurado(): boolean {
    return true;
  }
  guardarPdf(clave: string, contenido: Buffer): Promise<void> {
    this.objetos.set(clave, contenido);
    return Promise.resolve();
  }
  leer(clave: string): Promise<Buffer> {
    const objeto = this.objetos.get(clave);
    return objeto
      ? Promise.resolve(objeto)
      : Promise.reject(new Error('NoSuchKey'));
  }
}

describe('HU-009 (BL-454): copia del PDF del CFE en S3', () => {
  let app: INestApplication;
  let tenantPrisma: TenantPrismaService;
  let cfe: CfeService;
  let respaldo: RespaldoPdfService;
  const surtec = new SurtecFalso();
  const s3 = new S3EnMemoria();

  const enTenant = <T>(
    fn: Parameters<TenantPrismaService['runInTenantContext']>[1],
  ) => tenantPrisma.runInTenantContext(TENANT_ID, fn) as Promise<T>;

  /** Pedido pagado con su e-Ticket de Surtec, emitido hace 10 minutos. */
  const comprobante = () =>
    enTenant<{ id: string; ref: string }>(async (tx) => {
      const mesa = await tx.mesa.findFirstOrThrow({
        where: { restauranteId: RESTAURANTE_ID, esVirtual: true },
        select: { id: true },
      });
      const pedido = await tx.pedido.create({
        data: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          mesaId: mesa.id,
          idempotencyKey: `bl-454-respaldo-${randomUUID()}`,
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
              idempotencyKey: `bl-454-respaldo-pago-${randomUUID()}`,
              monto: new Prisma.Decimal('590'),
              medioPago: 'MERCADOPAGO',
              estado: 'APROBADO',
            },
          },
        },
        select: { id: true, pagos: { select: { id: true } } },
      });
      const ref = String(randomInt(1, 2_000_000_000));
      const fechaEmision = new Date(Date.now() - 10 * MINUTO);
      const creado = await tx.comprobanteFiscal.create({
        data: {
          tenantId: TENANT_ID,
          pedidoId: pedido.id,
          pagoId: pedido.pagos[0].id,
          tipoCfe: '101',
          serie: 'ZY',
          numero: randomInt(1, 9_999_999),
          hashSha256: randomBytes(32).toString('base64'),
          proveedor: 'SURTEC',
          proveedorRef: ref,
          idExterno: `bl-454-respaldo-${randomUUID()}`,
          fechaEmision,
          retencionHasta: new Date(fechaEmision.getFullYear() + 5, 0, 1),
        },
        select: { id: true },
      });
      return { id: creado.id, ref };
    });

  const leer = (id: string) =>
    enTenant<{
      urlPdf: string | null;
      pdfSha256: string | null;
      pdfIntentos: number;
    } | null>((tx) =>
      tx.comprobanteFiscal.findUnique({
        where: { id },
        select: { urlPdf: true, pdfSha256: true, pdfIntentos: true },
      }),
    );

  beforeAll(async () => {
    asegurarClaveQr();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SurtecClient)
      .useValue(surtec)
      .overrideProvider(AlmacenCfe)
      .useValue(s3)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tenantPrisma = await app.resolve(TenantPrismaService);
    cfe = await app.resolve(CfeService);
    respaldo = await app.resolve(RespaldoPdfService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 30000);

  it('[TC-I-176] Respaldo del PDF del CFE: se guarda en S3 con la clave del Anexo 6 y su SHA-256, la descarga sale de esa copia sin llamar a Surtec, otro tenant no lo toca y un fallo suma un intento y espera antes de reintentar', async () => {
    const ok = await comprobante();
    const falla = await comprobante();
    surtec.fallar.add(falla.ref);

    // Otro tenant no ve ni guarda los comprobantes del tenant A (RLS).
    await respaldo.respaldarTenant(
      TENANT_B,
      { dias: 7, maxIntentos: 10, lote: 500 },
      new Date(),
    );
    expect(surtec.pedidos).not.toContain(ok.ref);

    await respaldo.respaldarTenant(
      TENANT_ID,
      { dias: 7, maxIntentos: 10, lote: 500 },
      new Date(),
    );

    const guardado = await leer(ok.id);
    expect(guardado?.urlPdf).toMatch(
      new RegExp(`^${TENANT_ID}/cfe/\\d{4}/\\d{2}/${ok.id}\\.pdf$`),
    );
    expect(guardado?.pdfSha256).toBe(sha256Hex(PDF));
    expect(s3.objetos.get(guardado!.urlPdf!)).toEqual(PDF);

    // El que falló: un intento registrado, sin clave.
    expect(await leer(falla.id)).toMatchObject({
      urlPdf: null,
      pdfIntentos: 1,
    });

    // La corrida siguiente no vuelve a pedir ninguno de los dos: uno ya está
    // guardado y el otro espera 5 minutos antes de reintentar.
    const pedidosAntes = surtec.pedidos.length;
    await respaldo.respaldarTenant(
      TENANT_ID,
      { dias: 7, maxIntentos: 10, lote: 500 },
      new Date(),
    );
    expect(surtec.pedidos.slice(pedidosAntes)).not.toContain(ok.ref);
    expect(surtec.pedidos.slice(pedidosAntes)).not.toContain(falla.ref);

    // La descarga sale de S3.
    const pedidosAntesDeDescargar = surtec.pedidos.length;
    const pdf = await cfe.pdfDelComprobante(TENANT_ID, ok.id);
    expect(pdf.contenido).toBe(PDF.toString('base64'));
    expect(surtec.pedidos).toHaveLength(pedidosAntesDeDescargar);
  });
});
