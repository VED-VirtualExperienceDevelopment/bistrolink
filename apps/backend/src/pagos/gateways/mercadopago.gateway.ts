import { createHash } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  PagoGateway,
  ResultadoCobro,
  SolicitudCobro,
} from './pago-gateway.interface';

const MP_ORDERS_URL = 'https://api.mercadopago.com/v1/orders';
const ESTADOS_PENDIENTES = ['created', 'processing', 'action_required'];

interface DatosMercadoPago {
  token: string;
  payerEmail?: string;
  paymentMethodId: string;
  paymentMethodType?: 'credit_card' | 'debit_card';
  installments?: number;
}

interface OrdenMp {
  id?: string;
  status?: string;
  status_detail?: string;
  // En un 402 (transacción fallida), Orders devuelve la order dentro de `data`.
  data?: {
    id?: string;
    transactions?: { payments?: { status_detail?: string }[] };
  };
}

// Rechazos reales del emisor de la tarjeta (HTTP 402 + status_detail).
// Verificado contra el sandbox; se amplía a medida que aparecen casos.
const DETALLES_RECHAZO = new Set(['insufficient_amount', 'rejected_by_issuer']);

// UUID determinístico a partir de (tenant, clave del cliente): el mismo
// intento reintentado usa la misma X-Idempotency-Key en Mercado Pago.
function idempotencyKeyMp(tenantId: string, clave: string): string {
  const hex = createHash('sha256').update(`${tenantId}:${clave}`).digest('hex');
  const variante = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variante}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class MercadoPagoGateway implements PagoGateway {
  private readonly accessToken: string;

  constructor() {
    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('MP_ACCESS_TOKEN no configurado');
    }
    this.accessToken = accessToken;

    // Solo el n° de app y el user id (no son secretos): sirve para
    // confirmar que el .env cargado es el que uno cree.
    const [, appId, , , userId] = accessToken.split('-');
    Logger.log(
      `Mercado Pago: credenciales de la app ${appId} (usuario ${userId})`,
      MercadoPagoGateway.name,
    );
  }

  async cobrar(solicitud: SolicitudCobro): Promise<ResultadoCobro> {
    const datos = solicitud.datosPasarela as Partial<DatosMercadoPago>;
    if (!datos?.token || !datos.paymentMethodId) {
      throw new BadRequestException(
        'Faltan datos de pago para Mercado Pago (token, paymentMethodId)',
      );
    }

    // Sandbox: Mercado Pago solo acepta test@testuser.com como pagador.
    const payerEmail = process.env.MP_FORCE_PAYER_EMAIL ?? datos.payerEmail;
    if (!payerEmail) {
      throw new BadRequestException('Falta el email del pagador');
    }

    const monto = solicitud.monto.toFixed(2);

    const respuesta = await fetch(MP_ORDERS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKeyMp(
          solicitud.tenantId,
          solicitud.idempotencyKey,
        ),
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'automatic',
        total_amount: monto,
        external_reference: `pedido-${solicitud.pedidoId}`,
        payer: { email: payerEmail },
        transactions: {
          payments: [
            {
              amount: monto,
              payment_method: {
                id: datos.paymentMethodId,
                type: datos.paymentMethodType ?? 'credit_card',
                token: datos.token,
                installments: datos.installments ?? 1,
              },
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const cuerpo = (await respuesta.json().catch(() => ({}))) as OrdenMp;

    if (!respuesta.ok) {
      const detalleFallo =
        cuerpo.data?.transactions?.payments?.[0]?.status_detail;

      // Token de tarjeta vencido, usado o inválido: no es un rechazo del
      // emisor sino un dato inválido del cliente. No hubo cobro.
      if (respuesta.status === 402 && detalleFallo === 'invalid_card_token') {
        throw new BadRequestException(
          'Los datos de la tarjeta no son válidos o ya se usaron. Ingresalos de nuevo.',
        );
      }

      // Rechazo real de la tarjeta: es un resultado, no un error técnico.
      if (
        respuesta.status === 402 &&
        detalleFallo &&
        DETALLES_RECHAZO.has(detalleFallo)
      ) {
        return {
          aprobado: false,
          pasarelaReferencia: cuerpo.data?.id ?? '',
          motivoRechazo: detalleFallo,
        };
      }

      // El cuerpo del error de MP no incluye credenciales (el Authorization
      // solo viaja en el request), así que es seguro dejarlo en el log.
      Logger.error(
        `Mercado Pago rechazó la solicitud (HTTP ${respuesta.status}): ${JSON.stringify(cuerpo)}`,
        undefined,
        MercadoPagoGateway.name,
      );
      throw new BadGatewayException('Mercado Pago no pudo procesar el pago');
    }

    const estado = cuerpo.status ?? '';
    const detalle = cuerpo.status_detail;
    const aprobado = estado === 'processed' && detalle === 'accredited';
    const pendiente = ESTADOS_PENDIENTES.includes(estado);

    Logger.log(
      `Mercado Pago: order ${cuerpo.id} -> ${estado}/${detalle}`,
      MercadoPagoGateway.name,
    );

    return {
      aprobado,
      pendiente,
      pasarelaReferencia: String(cuerpo.id),
      motivoRechazo: aprobado || pendiente ? undefined : detalle,
    };
  }
}
