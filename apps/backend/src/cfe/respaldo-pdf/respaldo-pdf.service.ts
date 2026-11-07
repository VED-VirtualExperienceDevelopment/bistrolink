import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../../prisma/tenant-prisma.service';
import { SurtecClient } from '../surtec.client';
import {
  ESPERA_INICIAL_MS,
  tocaReintentar,
} from '../conciliacion-cfe/reintentos-cfe';
import { AlmacenCfe, clavePdfCfe, sha256Hex } from './almacen-cfe';
import { ConfiguracionRespaldoPdf } from './configuracion-respaldo-pdf';

const DIA_MS = 24 * 60 * 60 * 1000;

export interface ResumenRespaldoPdf {
  /** Comprobantes sin PDF guardado a los que les tocaba un intento. */
  revisados: number;
  guardados: number;
  fallidos: number;
}

export function resumenRespaldoPdfVacio(): ResumenRespaldoPdf {
  return { revisados: 0, guardados: 0, fallidos: 0 };
}

/**
 * HU-009 (BL-454): guarda en S3 una copia del PDF de cada CFE de Surtec,
 * con su SHA-256 propio, como pide la línea de base (Anexo 5, HU-009;
 * Anexo 6, §8.1). Surtec también lo conserva 5 años; la copia sirve para
 * descargarlo aunque Surtec no responda.
 *
 * Los reintentos se espacian igual que la conciliación de CFE (BL-96): 2 min
 * después de emitido el primero, y después 5 min, 15 min, 1 h y cada 6 h.
 * El PDF no va a los logs: el de una e-Factura lleva el RUT y la razón
 * social del receptor.
 */
@Injectable()
export class RespaldoPdfService {
  private readonly logger = new Logger(RespaldoPdfService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly surtec: SurtecClient,
    private readonly almacen: AlmacenCfe,
  ) {}

  configurado(): boolean {
    return this.almacen.configurado() && this.surtec.configurado();
  }

  async respaldarTenant(
    tenantId: string,
    configuracion: Pick<
      ConfiguracionRespaldoPdf,
      'dias' | 'maxIntentos' | 'lote'
    >,
    ahora: Date = new Date(),
  ): Promise<ResumenRespaldoPdf> {
    if (!this.configurado()) return resumenRespaldoPdfVacio();

    const candidatos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.comprobanteFiscal.findMany({
          where: {
            proveedor: 'SURTEC',
            proveedorRef: { not: null },
            urlPdf: null,
            pdfIntentos: { lt: configuracion.maxIntentos },
            fechaEmision: {
              gte: new Date(ahora.getTime() - configuracion.dias * DIA_MS),
              lte: new Date(ahora.getTime() - ESPERA_INICIAL_MS),
            },
          },
          select: {
            id: true,
            fechaEmision: true,
            pdfIntentos: true,
            pdfUltimoIntentoEn: true,
          },
          orderBy: { fechaEmision: 'asc' },
          take: configuracion.lote * 5,
        }),
    );

    const aGuardar = candidatos
      .filter((c) =>
        tocaReintentar(
          {
            createdAt: c.fechaEmision,
            cfeIntentos: c.pdfIntentos,
            cfeUltimoIntentoEn: c.pdfUltimoIntentoEn,
          },
          configuracion,
          ahora,
        ),
      )
      .slice(0, configuracion.lote);

    // Secuencial a propósito: no mandarle ráfagas a Surtec (120/min).
    let guardados = 0;
    for (const { id } of aGuardar) {
      if (await /* NOSONAR */ this.guardarPdf(tenantId, id)) guardados++;
    }
    return {
      revisados: aGuardar.length,
      guardados,
      fallidos: aGuardar.length - guardados,
    };
  }

  /**
   * Baja el PDF de Surtec y lo guarda en S3 con su hash. Nunca lanza: si
   * falla, suma un intento al comprobante y devuelve false. Si ya estaba
   * guardado, devuelve true sin hacer nada.
   */
  async guardarPdf(tenantId: string, comprobanteId: string): Promise<boolean> {
    const datos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => ({
        comprobante: await tx.comprobanteFiscal.findUnique({
          where: { id: comprobanteId },
          select: {
            serie: true,
            numero: true,
            proveedorRef: true,
            fechaEmision: true,
            urlPdf: true,
          },
        }),
        tenant: await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { rut: true },
        }),
      }),
    );
    const { comprobante, tenant } = datos;
    if (!comprobante?.proveedorRef || !tenant?.rut) return false;
    if (comprobante.urlPdf) return true;

    try {
      const { contenido } = await this.surtec.obtenerPdf(
        tenant.rut,
        comprobante.proveedorRef,
      );
      const clave = clavePdfCfe(
        tenantId,
        comprobante.fechaEmision,
        comprobanteId,
      );
      await this.almacen.guardarPdf(clave, contenido);
      await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        tx.comprobanteFiscal.update({
          where: { id: comprobanteId },
          data: { urlPdf: clave, pdfSha256: sha256Hex(contenido) },
        }),
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Respaldo del PDF: no se pudo guardar el del comprobante ${comprobante.serie}-${comprobante.numero}: ${(error as Error).message}`,
      );
      await this.registrarIntentoFallido(tenantId, comprobanteId);
      return false;
    }
  }

  private async registrarIntentoFallido(
    tenantId: string,
    comprobanteId: string,
  ): Promise<void> {
    try {
      await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
        tx.comprobanteFiscal.update({
          where: { id: comprobanteId },
          data: {
            pdfIntentos: { increment: 1 },
            pdfUltimoIntentoEn: new Date(),
          },
        }),
      );
    } catch (error_) {
      this.logger.warn(
        `Respaldo del PDF: no se pudo registrar el intento fallido del comprobante ${comprobanteId}: ${(error_ as Error).message}`,
      );
    }
  }
}
