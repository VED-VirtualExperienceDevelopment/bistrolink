import { Injectable, Logger } from '@nestjs/common';
import {
  PagoGateway,
  ResultadoCobro,
  SolicitudCobro,
} from './pago-gateway.interface';

// Temporal (Paso 1) — reemplazado por PlexoGateway/MercadoPagoGateway en
// los Pasos 3 y 4. Permite probar todo el flujo de dominio (idempotencia,
// cálculo de monto, cierre de mesa) sin depender de un sandbox real todavía.
@Injectable()
export class FakePagoGateway implements PagoGateway {
  async cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro> {
    Logger.warn(
      `FakePagoGateway: aprobando cobro simulado de ${solicitud.monto} (pedido ${solicitud.pedidoId})`,
      FakePagoGateway.name,
    );
    return {
      aprobado: true,
      pasarelaReferencia: `FAKE-${solicitud.idempotencyKey}`,
    };
  }
}
