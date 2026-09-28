import { Prisma } from '@prisma/client';

export interface SolicitudCobro {
  monto: Prisma.Decimal;
  idempotencyKey: string;
  pedidoId: string;
  tenantId: string;
  // Datos propios de cada pasarela (token de tarjeta, email del pagador,
  // etc.) — cada gateway valida e interpreta su propia forma, así el
  // contrato genérico no se ensucia con campos de una sola pasarela.
  datosPasarela: Record<string, unknown>;
}

export interface ResultadoCobro {
  aprobado: boolean;
  // La pasarela todavía no resolvió (ej. order en "processing"): no es
  // ni éxito ni rechazo, el pago queda PENDIENTE hasta confirmarse.
  pendiente?: boolean;
  pasarelaReferencia: string;
  motivoRechazo?: string;
}

export const PAGO_GATEWAY = 'PAGO_GATEWAY';

export interface PagoGateway {
  cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro>;
}
