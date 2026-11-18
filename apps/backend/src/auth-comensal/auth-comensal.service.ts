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
import { nombreComensalTecnico } from './nombre-comensal-tecnico';
import {
  DatosTokenInvitado,
  emisorTokenComensalDesdeEntorno,
  tokenInvitadoDesdeEntorno,
} from './token-invitado';

export interface TokenComensal {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthComensalService {
  /**
   * HU-052 (BL-579): quién emite el token (COMENSAL_TOKEN_EMISOR). Por
   * defecto Keycloak, como hasta ahora. Se lee al crear el servicio: un
   * cambio de la variable se aplica con el redeploy de la API.
   */
  private readonly emisor = emisorTokenComensalDesdeEntorno();

  /** Solo con el emisor `api`; null si falta COMENSAL_TOKEN_CLAVE. */
  private readonly tokensInvitado =
    this.emisor === 'api' ? tokenInvitadoDesdeEntorno() : null;

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly qrMesaAcceso: QrMesaAccesoService,
    private readonly tenantEstado: TenantEstadoService,
    private readonly linkPago: LinkPagoService,
  ) {}

  private get keycloakUrl(): string {
    return process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  }

  private get realm(): string {
    return process.env.KEYCLOAK_REALM ?? 'bistrolink';
  }

  private get clientId(): string {
    return process.env.KEYCLOAK_CLIENT_ID ?? 'bistrolink-backend';
  }

  private get clientSecret(): string {
    const secret = process.env.KEYCLOAK_CLIENT_SECRET;
    if (!secret) {
      throw new Error('Falta KEYCLOAK_CLIENT_SECRET en el .env');
    }
    return secret;
  }

  private get comensalPassword(): string {
    const password = process.env.KEYCLOAK_COMENSAL_PASSWORD;
    if (!password) {
      throw new Error('Falta KEYCLOAK_COMENSAL_PASSWORD en el .env');
    }
    return password;
  }

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
    return this.emitirSegunEmisor({
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
    return this.emitirSegunEmisor({
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
    return this.emitirSegunEmisor({
      tenantId: link.tenantId,
      restauranteId: link.restauranteId,
      canal: { tipo: 'link', pedidoId: link.pedidoId },
    });
  }

  /**
   * HU-052 (BL-579): con el emisor `api`, la API firma el token de invitado
   * con el canal por el que entró el comensal, sin ir a Keycloak. Con
   * `keycloak`, el usuario técnico del tenant, como hasta ahora. El contrato
   * de la respuesta ({ accessToken, expiresIn }) es el mismo.
   */
  private async emitirSegunEmisor(
    datos: DatosTokenInvitado,
  ): Promise<TokenComensal> {
    if (this.emisor === 'keycloak') {
      return this.pedirTokenKeycloak(datos.tenantId);
    }
    if (!this.tokensInvitado) {
      console.error(
        'COMENSAL_TOKEN_EMISOR=api sin COMENSAL_TOKEN_CLAVE: no se puede emitir el token del comensal',
      );
      throw new InternalServerErrorException(
        'No se pudo emitir el token de acceso',
      );
    }
    return this.tokensInvitado.emitir(datos);
  }

  /**
   * Pide el JWT del comensal técnico del tenant a Keycloak. El nombre del
   * usuario no se deduce del tenantId (BL-271, nombre-comensal-tecnico.ts).
   * Es el mismo usuario para cualquier mesa del tenant: la mesa se valida
   * aparte (BL-204, MesaQrGuard en pedidos y llamados).
   */
  private async pedirTokenKeycloak(tenantId: string): Promise<TokenComensal> {
    const username = nombreComensalTecnico(tenantId);

    const res = await fetch(
      `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          username,
          password: this.comensalPassword,
        }),
      },
    );

    if (!res.ok) {
      console.error(
        `No se pudo emitir token de comensal para tenant ${tenantId}: ${res.status} ${await res.text()}`,
      );
      throw new InternalServerErrorException(
        'No se pudo emitir el token de acceso',
      );
    }

    const data = await res.json();
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }
}
