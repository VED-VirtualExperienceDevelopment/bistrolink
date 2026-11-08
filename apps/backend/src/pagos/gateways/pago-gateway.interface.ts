import { Prisma } from '@prisma/client';

export interface SolicitudCobro {
  monto: Prisma.Decimal;
  idempotencyKey: string;
  pedidoId: string;
  tenantId: string;
  datosPasarela: Record<string, unknown>;
}

export interface AccionRequerida {
  tipo: 'iframe';
  url: string;
}

export interface ResultadoCobro {
  aprobado: boolean;
  pendiente?: boolean;
  pasarelaReferencia: string;
  motivoRechazo?: string;
  // Solo pasarelas con checkout embebido (Plexo): el frontend tiene que
  // mostrarle esto al comensal ANTES de que exista cualquier resultado.
  accionRequerida?: AccionRequerida;
}

export interface PagoGateway {
  cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro>;
}
