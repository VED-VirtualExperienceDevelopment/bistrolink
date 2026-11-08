import { Logger } from '@nestjs/common';
import { PagoEstado, PagoOrigen, PrismaClient } from '@prisma/client';

/** HU-032 (BL-202): motivo de un pago que venció sin confirmación. */
export const MOTIVO_VENCIDO = 'VENCIDO';

/**
 * HU-032 (BL-202): el pago se cobró (la pasarela lo aprobó) pero el pedido ya
 * no lo puede usar: venció, el comensal pagó de nuevo con otro pago o el
 * pedido se canceló al cerrar la mesa. Hay que devolver el dinero (HU-024).
 */
export const DETALLE_REQUIERE_REEMBOLSO = 'REQUIERE_REEMBOLSO';

const LARGO_DETALLE = 60;

export interface CambioDePago {
  tenantId: string;
  pagoId: string;
  estadoAnterior: PagoEstado;
  estadoNuevo: PagoEstado;
  origen: PagoOrigen;
  detalle?: string | null;
}

/** Recorta un texto de la pasarela al largo de la columna (VARCHAR(60)). */
export function textoCorto(texto?: string | null): string | null {
  return texto ? texto.slice(0, LARGO_DETALLE) : null;
}

/**
 * Deja el cambio de estado en pago_estado_historial, dentro de la misma
 * transacción que lo aplica: o se guardan los dos o ninguno. También lo
 * registra en el log (contexto «Pagos»), para seguirlo en Railway o Loki.
 */
export async function registrarCambioPago(
  tx: PrismaClient,
  cambio: CambioDePago,
): Promise<void> {
  const detalle = textoCorto(cambio.detalle);
  await tx.pagoEstadoHistorial.create({
    data: {
      tenantId: cambio.tenantId,
      pagoId: cambio.pagoId,
      estadoAnterior: cambio.estadoAnterior,
      estadoNuevo: cambio.estadoNuevo,
      origen: cambio.origen,
      detalle,
    },
  });
  Logger.log(
    {
      message: `Pago ${cambio.pagoId}: ${cambio.estadoAnterior} -> ${cambio.estadoNuevo} (${cambio.origen})`,
      tenantId: cambio.tenantId,
      pagoId: cambio.pagoId,
      estadoAnterior: cambio.estadoAnterior,
      estadoNuevo: cambio.estadoNuevo,
      origen: cambio.origen,
      detalle,
    },
    'Pagos',
  );
}
