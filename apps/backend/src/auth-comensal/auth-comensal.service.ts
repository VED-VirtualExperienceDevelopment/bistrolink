import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QrMesaAccesoService } from '../qr-mesa/qr-mesa-acceso.service';

export interface TokenComensal {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthComensalService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly qrMesaAcceso: QrMesaAccesoService,
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

    return this.pedirTokenKeycloak(tenantId);
  }

  /**
   * HU-034 (BL-204): token del comensal en una mesa. El tenant sale del QR
   * (validado y vigente), nunca del cliente. QrMesaAccesoService responde
   * 404 si el QR no es válido y 410 si fue reemplazado.
   */
  async emitirTokenPorQr(qrToken: string): Promise<TokenComensal> {
    const mesa = await this.qrMesaAcceso.resolver(qrToken);
    return this.pedirTokenKeycloak(mesa.tenantId);
  }

  /**
   * Pide el JWT del comensal técnico del tenant (comensal-<tenantId>) a
   * Keycloak. Es el mismo usuario para cualquier mesa del tenant: la mesa se valida
   * aparte (BL-204, MesaQrGuard en pedidos y llamados).
   */
  private async pedirTokenKeycloak(tenantId: string): Promise<TokenComensal> {
    const username = `comensal-${tenantId}`;

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
