import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  configuracionWhatsapp,
  motivoDelError,
  type ConfiguracionWhatsapp,
} from './configuracion-whatsapp';
import { EvolutionClienteService } from './evolution-cliente.service';
import { telefonoParaLog } from './mensaje-evolution';

/** Lo que pasó con un aviso (para los tests y los logs). */
export type ResultadoAviso =
  'apagado' | 'sin-instancia' | 'no-aplica' | 'enviado' | 'no-enviado';

export function textoPagoAprobado(codigo: string | null): string {
  return [
    '¡Pago aprobado! Tu pedido ya está en cocina.',
    codigo
      ? `Tu código de retiro es *${codigo}*. Te avisamos por acá cuando esté listo.`
      : 'Te avisamos por acá cuando esté listo.',
  ].join('\n');
}

// BL-611: el aviso de listo es el último que recibe el comensal, así que
// cierra con el agradecimiento (como la pantalla «Gracias por tu compra»).
export function textoPedidoListo(codigo: string | null): string {
  return [
    codigo
      ? `¡Tu pedido está listo! Pasá por el mostrador y decí el código *${codigo}*.`
      : '¡Tu pedido está listo! Pasá por el mostrador a retirarlo.',
    '¡Gracias por tu compra!',
  ].join('\n');
}

/** La primera instancia configurada para el tenant, o null. */
export function instanciaDelTenant(
  config: ConfiguracionWhatsapp,
  tenantId: string,
): string | null {
  for (const [instancia, tenant] of config.instancias) {
    if (tenant === tenantId) return instancia;
  }
  return null;
}

/** «+598991234567» → «598991234567», o null si no es un número posible. */
export function telefonoDelContacto(contacto: string | null): string | null {
  const digitos = contacto?.replace(/^\+/, '') ?? '';
  return /^\d{8,15}$/.test(digitos) ? digitos : null;
}

/**
 * HU-010 (BL-604): avisos por WhatsApp de un pedido que se hizo por el bot.
 *
 * - Pago aprobado, con el código de retiro (R-NNN).
 * - Pedido listo para retirar.
 *
 * Solo para pedidos con canal WHATSAPP y con el contacto guardado (el
 * comensal aceptó el aviso de privacidad, HU-036). Se llama después de
 * confirmar la transacción y en segundo plano: un aviso que no sale nunca
 * toca el pago ni el KDS. Sin el número completo ni el texto en los logs.
 */
@Injectable()
export class AvisosWhatsappService {
  private readonly logger = new Logger(AvisosWhatsappService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly evolution: EvolutionClienteService,
  ) {}

  pagoAprobado(tenantId: string, pedidoId: string): Promise<ResultadoAviso> {
    return this.avisar(tenantId, pedidoId, textoPagoAprobado);
  }

  pedidoListo(tenantId: string, pedidoId: string): Promise<ResultadoAviso> {
    return this.avisar(tenantId, pedidoId, textoPedidoListo);
  }

  /** Como pagoAprobado/pedidoListo, sin esperar ni lanzar. */
  enSegundoPlano(aviso: Promise<ResultadoAviso>, pedidoId: string): void {
    void aviso.catch((error: unknown) =>
      this.logger.warn(
        `WhatsApp: no se pudo avisar del pedido ${pedidoId}: ${motivoDelError(error)}`,
      ),
    );
  }

  private async avisar(
    tenantId: string,
    pedidoId: string,
    texto: (codigo: string | null) => string,
  ): Promise<ResultadoAviso> {
    const config = configuracionWhatsapp(process.env);
    if (!config) return 'apagado';
    const instancia = instanciaDelTenant(config, tenantId);
    if (!instancia) return 'sin-instancia';

    const pedido = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.pedido.findUnique({
        where: { id: pedidoId },
        select: { canal: true, retiroContacto: true, codigoRetiro: true },
      }),
    );
    if (pedido?.canal !== 'WHATSAPP') return 'no-aplica';
    const telefono = telefonoDelContacto(pedido.retiroContacto);
    if (!telefono) return 'no-aplica';

    const enviados = await this.evolution.enviar(config, instancia, telefono, [
      texto(pedido.codigoRetiro),
    ]);
    if (enviados === 0) {
      this.logger.warn(
        `WhatsApp: no salió el aviso del pedido ${pedidoId} a ${telefonoParaLog(telefono)}`,
      );
      return 'no-enviado';
    }
    return 'enviado';
  }
}
