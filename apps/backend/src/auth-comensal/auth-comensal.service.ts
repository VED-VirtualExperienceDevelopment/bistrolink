import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { LinkPagoService } from '../link-pago/link-pago.service';
import {
  exigirSesionAbierta,
  QrMesaAccesoService,
} from '../qr-mesa/qr-mesa-acceso.service';
import {
  MENSAJE_SUSPENDIDO_COMENSAL,
  TenantEstadoService,
} from '../tenant-estado/tenant-estado.service';
import {
  DatosTokenInvitado,
  tokenInvitadoDesdeEntorno,
} from './token-invitado';

export interface TokenComensal {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthComensalService {
  /**
   * HU-052: la API firma el token de invitado del comensal (ADR 0014).
   * Desde BL-581 es el único emisor: ya no hay usuario técnico en Keycloak.
   * Null solo si falta COMENSAL_TOKEN_CLAVE, que el control de arranque
   * exige (startup-env-check.ts).
   */
  private readonly tokensInvitado = tokenInvitadoDesdeEntorno();

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly qrMesaAcceso: QrMesaAccesoService,
    private readonly tenantEstado: TenantEstadoService,
    private readonly linkPago: LinkPagoService,
  ) {}

  /**
   * Token del comensal para el pedido para retirar (link web del local).
   * El restaurante tiene que existir en el tenant (RLS); si no, 404.
   * BL-413: con el establecimiento suspendido, 403 (no se emite el token).
   */
  async emitirToken(
    tenantId: string,
    restauranteId: string,
  ): Promise<TokenComensal> {
    const existe = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.restaurante.findUnique({
        where: { id: restauranteId },
        select: { id: true },
      }),
    );

    if (!existe) {
      throw new NotFoundException('Restaurante no encontrado');
    }

    await this.tenantEstado.asegurarActivo(
      tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    return this.emitirTokenInvitado({
      tenantId,
      restauranteId,
      canal: { tipo: 'retiro', restauranteId },
    });
  }

  /**
   * HU-034 (BL-204): token del comensal en una mesa. El tenant sale del QR
   * (validado y vigente), nunca del cliente. QrMesaAccesoService responde
   * 404 si el QR no es válido y 410 si fue reemplazado. BL-413: 403 si el
   * establecimiento está suspendido.
   */
  async emitirTokenPorQr(
    qrToken: string,
    sesionMesa?: string,
  ): Promise<TokenComensal> {
    const mesa = await this.qrMesaAcceso.resolver(qrToken);
    await this.tenantEstado.asegurarActivo(
      mesa.tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    // HU-017 (BL-60): solo con la sesión de la mesa abierta, y la de esta
    // página (410 MESA_CERRADA / SESION_VENCIDA).
    exigirSesionAbierta(mesa, sesionMesa);
    return this.emitirTokenInvitado({
      tenantId: mesa.tenantId,
      restauranteId: mesa.restauranteId,
      // exigirSesionAbierta ya garantizó que la sesión existe.
      canal: {
        tipo: 'mesa',
        mesaId: mesa.mesaId,
        sesionId: mesa.sesionId as string,
      },
    });
  }

  /**
   * HU-033 (BL-203): token del comensal que abre un link de pago. El tenant
   * sale del link (vigente o con el pedido ya pagado), nunca del cliente:
   * 404 si no es un link válido y 410 si venció, lo reemplazó otro o el
   * pedido se canceló. BL-413: 403 si el establecimiento está suspendido.
   */
  async emitirTokenPorLink(linkToken: string): Promise<TokenComensal> {
    const link = await this.linkPago.resolver(linkToken);
    await this.tenantEstado.asegurarActivo(
      link.tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    return this.emitirTokenInvitado({
      tenantId: link.tenantId,
      restauranteId: link.restauranteId,
      canal: { tipo: 'link', pedidoId: link.pedidoId },
    });
  }

  /**
   * HU-052: la API firma el token de invitado con el canal por el que entró
   * el comensal, sin ir a Keycloak. La respuesta ({ accessToken, expiresIn })
   * es la misma que tenía el token de Keycloak.
   */
  private emitirTokenInvitado(datos: DatosTokenInvitado): TokenComensal {
    if (!this.tokensInvitado) {
      console.error(
        'Falta COMENSAL_TOKEN_CLAVE: no se puede emitir el token del comensal',
      );
      throw new InternalServerErrorException(
        'No se pudo emitir el token de acceso',
      );
    }
    return this.tokensInvitado.emitir(datos);
  }
}
