import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

export interface TokenComensal {
  accessToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthComensalService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

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

  async emitirToken(tenantId: string, mesaId: string): Promise<TokenComensal> {
    const mesa = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.mesa.findUnique({ where: { id: mesaId } }),
    );

    if (!mesa) {
      throw new NotFoundException(
        'Mesa no encontrada para este establecimiento',
      );
    }

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
