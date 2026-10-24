import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { SurtecClient, SurtecError } from './surtec.client';

// Res. DGI 798/2012: los CFE se conservan 5 años.
const ANIOS_RETENCION = 5;

/**
 * BL-311: espera antes de cada reintento de la emisión en segundo plano
 * (3 intentos en total). Acotado a propósito: si Surtec sigue sin
 * responder, el pago queda APROBADO sin comprobante y lo resuelve la
 * conciliación (HU-023, BL-96). Reintentar no duplica: mismo id_externo.
 */
export const ESPERAS_REINTENTO_CFE_MS = [5_000, 30_000];

/**
 * Vale la pena reintentar: Surtec caído o lento (5xx, 429, timeout, red).
 * Un 4xx (ej. «no es un emisor válido») va a fallar igual: no se reintenta.
 */
export function esErrorTransitorio(error: unknown): boolean {
  if (error instanceof SurtecError && error.status !== undefined) {
    return error.status >= 500 || error.status === 429;
  }
  // Credenciales rechazadas o Surtec sin configurar: tampoco cambia solo.
  if (error instanceof SurtecError) {
    return false;
  }
  return true; // fetch failed, AbortSignal.timeout, etc.
}

export interface ResumenComprobante {
  serie: string;
  numero: number;
  urlConsulta: string | null;
}

@Injectable()
export class CfeService {
  // Emisiones en curso por pago: si el POST del comensal y el webhook de
  // Mercado Pago llegan juntos, se emite una sola vez.
  private readonly enCurso = new Map<
    string,
    Promise<ResumenComprobante | null>
  >();

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
      registrarFallo(pagoId, error);
      return null;
    }
  }

  /**
   * BL-311: emite el eTicket sin hacer esperar a quien llama (el comensal
   * ve «¡Tu pedido ya está en cocina!» apenas se aprueba el pago; la
   * pantalla consulta el comprobante hasta que aparece). Si Surtec falla
   * por algo transitorio, reintenta según ESPERAS_REINTENTO_CFE_MS.
   * Nunca lanza.
   */
  emitirEnSegundoPlano(tenantId: string, pagoId: string): void {
    void this.emitirConReintentos(tenantId, pagoId);
  }

  emitirConReintentos(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    const actual = this.enCurso.get(pagoId);
    if (actual) {
      return actual;
    }
    const emision = this.reintentar(tenantId, pagoId).finally(() =>
      this.enCurso.delete(pagoId),
    );
    this.enCurso.set(pagoId, emision);
    return emision;
  }

  private async reintentar(
    tenantId: string,
    pagoId: string,
  ): Promise<ResumenComprobante | null> {
    for (let intento = 0; ; intento++) {
      try {
        return await this.emitir(tenantId, pagoId);
      } catch (error) {
        const espera = ESPERAS_REINTENTO_CFE_MS[intento];
        if (espera === undefined || !esErrorTransitorio(error)) {
          registrarFallo(pagoId, error);
          return null;
        }
        Logger.warn(
          `CFE: falló la emisión del pago ${pagoId} (intento ${intento + 1}), se reintenta en ${espera / 1000} s: ${mensajeDe(error)}`,
          CfeService.name,
        );
        await esperar(espera);
      }
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
    if (pago?.estado !== 'APROBADO') {
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

// unref: un reintento pendiente no impide que el proceso se apague.
function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

function registrarFallo(pagoId: string, error: unknown): void {
  Logger.error(
    `CFE: no se pudo emitir el comprobante del pago ${pagoId}: ${mensajeDe(error)}`,
    undefined,
    CfeService.name,
  );
}

function resumir(c: {
  serie: string;
  numero: number;
  urlConsulta: string | null;
}): ResumenComprobante {
  return { serie: c.serie, numero: c.numero, urlConsulta: c.urlConsulta };
}
