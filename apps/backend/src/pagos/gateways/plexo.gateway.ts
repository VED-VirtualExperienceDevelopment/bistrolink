import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import {
  AccionRequerida,
  PagoGateway,
  ResultadoCobro,
  SolicitudCobro,
} from './pago-gateway.interface';
import { armarReferenciaExterna } from '../webhooks/referencia-externa';

const PLEXO_API_URL =
  process.env.PLEXO_API_URL ?? 'https://api.testing.plexo.com.uy';

interface SesionPlexo {
  id?: string;
  actions?: { rel: string; href: string; method: string }[];
}

@Injectable()
export class PlexoGateway implements PagoGateway {
  private readonly credencial: string | undefined;

  constructor() {
    const clientId = process.env.PLEXO_CLIENT_ID;
    const apiKey = process.env.PLEXO_API_KEY;
    if (!clientId || !apiKey) {
      Logger.warn(
        'PLEXO_CLIENT_ID/PLEXO_API_KEY no configurados: los pagos con Plexo van a fallar',
        PlexoGateway.name,
      );
      return;
    }
    this.credencial = Buffer.from(`${clientId}:${apiKey}`).toString('base64');
  }

  async cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro> {
    if (!this.credencial) {
      throw new BadGatewayException(
        'Plexo no está configurado en este momento',
      );
    }

    const merchantId = process.env.PLEXO_MERCHANT_ID;
    if (!merchantId) {
      throw new Error('PLEXO_MERCHANT_ID no configurado');
    }

    // Plexo llama al callback y redirige al comensal a estas URLs: tienen que
    // ser públicas (no localhost) y estar definidas, o el pago nunca se resuelve.
    const backendUrl = process.env.BACKEND_URL;
    const frontendUrl = process.env.FRONTEND_URL;
    if (!backendUrl || !frontendUrl) {
      throw new Error('BACKEND_URL y FRONTEND_URL no configurados');
    }

    const referenceId = armarReferenciaExterna(
      solicitud.tenantId,
      solicitud.pedidoId,
    );

    const respuesta = await fetch(`${PLEXO_API_URL}/v1/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.credencial}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchantId: Number(merchantId),
        referenceId,
        type: 'checkout',
        paymentRequest: {
          referenceId,
          invoiceNumber: referenceId.slice(0, 12),
          installments: 1,
          amount: {
            total: solicitud.monto.toNumber(),
            currency: 'UYU',
          },
        },
        settings: {
          callbacks: {
            paymentCallbackUrl: `${backendUrl}/webhooks/plexo`,
          },
          redirects: {
            defaultUrl: `${frontendUrl}/pago-completado`,
            cancelUrl: `${frontendUrl}/pago-cancelado`,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const cuerpo = (await respuesta.json().catch(() => ({}))) as SesionPlexo;

    if (!respuesta.ok) {
      Logger.error(
        `Plexo rechazó la creación de la sesión (HTTP ${respuesta.status}): ${JSON.stringify(cuerpo)}`,
        undefined,
        PlexoGateway.name,
      );
      throw new BadGatewayException('Plexo no pudo iniciar el pago');
    }

    const embebido = cuerpo.actions?.find(
      (a) => a.rel === 'self' && a.method === 'EMBEDDED',
    );
    if (!embebido) {
      throw new BadGatewayException(
        'Plexo no devolvió una URL de checkout embebido',
      );
    }

    const accionRequerida: AccionRequerida = {
      tipo: 'iframe',
      url: embebido.href,
    };

    Logger.log(
      `Plexo: sesión ${cuerpo.id} creada, esperando que el comensal complete el pago en el iframe`,
      PlexoGateway.name,
    );

    return {
      aprobado: false,
      pendiente: true,
      pasarelaReferencia: cuerpo.id ?? '',
      accionRequerida,
    };
  }

  async consultarPago(paymentId: string): Promise<{
    id: string;
    status: string;
    totalAmount?: number;
    referenceId?: string;
  } | null> {
    if (!this.credencial) {
      throw new BadGatewayException(
        'Plexo no está configurado en este momento',
      );
    }

    const respuesta = await fetch(
      `${PLEXO_API_URL}/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: { Authorization: `Basic ${this.credencial}` },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (respuesta.status === 404) {
      return null;
    }

    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      Logger.error(
        `Plexo no pudo consultar el pago ${paymentId} (HTTP ${respuesta.status}): ${JSON.stringify(cuerpo)}`,
        undefined,
        PlexoGateway.name,
      );
      throw new BadGatewayException('No se pudo consultar el pago en Plexo');
    }

    return {
      id: cuerpo.id ?? paymentId,
      status: cuerpo.status ?? '',
      totalAmount: cuerpo.amount?.total,
      referenceId: cuerpo.referenceId,
    };
  }
}
