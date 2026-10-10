import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SurtecClient } from './surtec.client';

// Res. DGI 798/2012: los CFE se conservan 5 años.
const ANIOS_RETENCION = 5;

export interface ResumenComprobante {
  serie: string;
  numero: number;
  urlConsulta: string | null;
}

@Injectable()
export class CfeService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly surtec: SurtecClient,
  ) {}

  // Emite el eTicket de un pago APROBADO. Nunca lanza: el cobro ya se hizo y
  // no puede fallar porque falle la facturación. Si no se pudo emitir, el
  // pago queda APROBADO sin comprobante y se reintenta (mismo id_externo, así
  // que Surtec no duplica) o se concilia (HU-023 / BL-96).
  async intentarEmitir(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    try {
      return await this.emitir(tenantId, pagoId);
    } catch (error) {
      Logger.error(
        `CFE: no se pudo emitir el comprobante del pago ${pagoId}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        CfeService.name,
      );
      return null;
    }
  }

  private async emitir(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    if (!this.surtec.configurado()) {
      Logger.warn(
        'CFE: Surtec no está configurado, no se emite el comprobante',
        CfeService.name,
      );
      return null;
    }

    const datos = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const pago = await tx.pago.findUnique({
          where: { id: pagoId },
          include: {
            comprobantes: true,
            pedido: { include: { lineas: true } },
          },
        });
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { rut: true },
        });
        return { pago, tenant };
      },
    );

    const { pago, tenant } = datos;
    if (!pago || pago.estado !== 'APROBADO') {
      return null;
    }
    const existente = pago.comprobantes[0];
    if (existente) {
      return resumir(existente);
    }
    if (!tenant) {
      return null;
    }

    const idExterno = `bl-${pago.id}`;
    const emitido = await this.surtec.emitirETicket({
      rutEmisor: tenant.rut,
      idExterno,
      items: pago.pedido.lineas.map((l) => ({
        concepto: l.nombreSnapshot.slice(0, 100),
        cantidad: l.cantidad,
        precio: l.precioUnitarioSnapshot.toNumber(),
      })),
      adenda: `Pedido ${pago.pedidoId.slice(0, 8)}`,
    });

    const ahora = new Date();
    const retencionHasta = new Date(ahora);
    retencionHasta.setFullYear(retencionHasta.getFullYear() + ANIOS_RETENCION);

    const datosComprobante = {
      tenantId,
      pedidoId: pago.pedidoId,
      pagoId: pago.id,
      tipoCfe: '101',
      serie: emitido.serie,
      numero: emitido.numero,
      hashSha256: emitido.hash ?? null,
      proveedor: 'SURTEC',
      proveedorRef: emitido.id,
      idExterno,
      caeNumero: emitido.caeNumero ?? null,
      caeVencimiento: emitido.caeVencimiento ?? null,
      urlConsulta: emitido.url ?? null,
      fechaEmision: ahora,
      retencionHasta,
    };

    // upsert por id_externo: si dos webhooks llegan a la vez, el segundo no
    // duplica el comprobante.
    const guardado = await this.tenantPrisma.runInTenantContext(
      tenantId,
      (tx) =>
        tx.comprobanteFiscal.upsert({
          where: { idExterno },
          create: datosComprobante,
          update: {},
        }),
    );
    return resumir(guardado);
  }
}

function resumir(c: {
  serie: string;
  numero: number;
  urlConsulta: string | null;
}): ResumenComprobante {
  return { serie: c.serie, numero: c.numero, urlConsulta: c.urlConsulta };
}
