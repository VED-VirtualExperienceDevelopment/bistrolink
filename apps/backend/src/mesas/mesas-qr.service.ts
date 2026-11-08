import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QrMesaTokenService } from '../qr-mesa/qr-mesa-token.service';

export interface QrMesa {
  id: string;
  numero: number;
  url: string;
}

export interface QrRestaurante {
  restaurante: {
    id: string;
    nombre: string;
    /** Link web del local (HU-002), para el QR de vidriera o redes. */
    urlWeb: string;
  };
  mesas: QrMesa[];
}

/**
 * HU-034 (BL-204): URLs de los QR de cada mesa y su regeneración. Solo
 * ADMIN (lo controla MesasController). Las URLs de mesa son /q/<token>,
 * con el token opaco de QrMesaTokenService: nunca llevan ids internos.
 */
@Injectable()
export class MesasQrService {
  private readonly logger = new Logger(MesasQrService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly qrToken: QrMesaTokenService,
  ) {}

  /**
   * URL pública del frontend, sin la barra final. Si falta, se corta acá:
   * es preferible un error a un PDF con QRs que apuntan a localhost.
   */
  private urlBaseFrontend(): string {
    const url = process.env.FRONTEND_URL;
    if (!url) {
      this.logger.error('Falta FRONTEND_URL: no se pueden generar los QR');
      throw new InternalServerErrorException(
        'No se pudieron generar las URLs de los QR',
      );
    }
    let base = url;
    while (base.endsWith('/')) {
      base = base.slice(0, -1);
    }
    return base;
  }

  private urlMesa(
    base: string,
    tenantId: string,
    mesa: { id: string; qrVersion: number },
  ): string {
    const token = this.qrToken.cifrar({
      tenantId,
      mesaId: mesa.id,
      version: mesa.qrVersion,
    });
    return `${base}/q/${token}`;
  }

  async listar(
    tenantId: string,
    restauranteId: string,
  ): Promise<QrRestaurante> {
    const base = this.urlBaseFrontend();

    const { restaurante, mesas } = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        // Además de RLS, se compara el tenant de forma explícita (mismo
        // criterio que guardarLayout, TC-I-033).
        const restaurante = await tx.restaurante.findUnique({
          where: { id: restauranteId },
          select: { id: true, nombre: true, tenantId: true },
        });
        if (restaurante?.tenantId !== tenantId) {
          throw new NotFoundException(
            'Restaurante no encontrado para este establecimiento',
          );
        }

        // La mesa virtual (HU-003, número 0) no genera QR: no es una mesa
        // física.
        const mesas = await tx.mesa.findMany({
          where: { tenantId, restauranteId, esVirtual: false },
          select: { id: true, numero: true, qrVersion: true },
          orderBy: { numero: 'asc' },
        });

        return { restaurante, mesas };
      },
    );

    return {
      restaurante: {
        id: restaurante.id,
        nombre: restaurante.nombre,
        urlWeb: `${base}/m/${tenantId}/restaurante/${restaurante.id}`,
      },
      mesas: mesas.map((mesa) => ({
        id: mesa.id,
        numero: mesa.numero,
        url: this.urlMesa(base, tenantId, mesa),
      })),
    };
  }

  /**
   * Suma 1 a la versión del QR de la mesa. El token anterior deja de ser
   * válido: el acceso al menú y los pedidos con ese token se rechazan
   * (410 Gone).
   */
  async regenerar(
    tenantId: string,
    mesaId: string,
    actorKeycloakId: string,
  ): Promise<QrMesa> {
    const base = this.urlBaseFrontend();

    const mesa = await this.tenantPrisma.runInTenantContext(
      tenantId,
      async (tx) => {
        const existente = await tx.mesa.findUnique({
          where: { id: mesaId },
          select: { id: true, tenantId: true, esVirtual: true },
        });
        if (existente?.tenantId !== tenantId || existente.esVirtual) {
          throw new NotFoundException(
            'Mesa no encontrada para este establecimiento',
          );
        }

        return tx.mesa.update({
          where: { id: mesaId },
          data: { qrVersion: { increment: 1 } },
          select: { id: true, numero: true, qrVersion: true },
        });
      },
    );

    // Registro de la acción administrativa. Cuando exista HU-035, pasa a
    // AuditLogService.
    this.logger.log({
      message: 'QR de mesa regenerado',
      tenantId,
      mesaId: mesa.id,
      numero: mesa.numero,
      qrVersion: mesa.qrVersion,
      actorKeycloakId,
    });

    return {
      id: mesa.id,
      numero: mesa.numero,
      url: this.urlMesa(base, tenantId, mesa),
    };
  }
}
