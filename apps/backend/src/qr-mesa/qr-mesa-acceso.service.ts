import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QrMesaTokenService } from './qr-mesa-token.service';

/** La mesa a la que corresponde un QR válido y vigente. */
export interface MesaDelQr {
  tenantId: string;
  mesaId: string;
  restauranteId: string;
  numero: number;
}

// Mismo mensaje para todo lo que no es un QR válido (formato, firma, mesa
// inexistente o virtual): no se distingue el motivo.
export const MENSAJE_QR_INVALIDO = 'QR no válido';
export const MENSAJE_QR_REEMPLAZADO =
  'Este QR fue reemplazado. Pedile al personal el QR actualizado de la mesa.';

/**
 * HU-034 (BL-204): resuelve el token de la URL /q/<token> a la mesa que
 * representa, validando que el QR siga vigente. Es el único lugar donde se
 * decide si un QR vale: lo usan el menú público, la emisión del token del
 * comensal y (BL-204, paso 5) el guard de pedidos y llamados.
 */
@Injectable()
export class QrMesaAccesoService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly qrToken: QrMesaTokenService,
  ) {}

  async resolver(token: string): Promise<MesaDelQr> {
    const datos = this.qrToken.descifrar(token);
    if (!datos) {
      throw new NotFoundException(MENSAJE_QR_INVALIDO);
    }

    // El tenant sale del token, que está autenticado por AES-GCM: no lo
    // pudo elegir quien manda la request.
    const mesa = await this.tenantPrisma.runInTenantContext(
      datos.tenantId,
      (tx) =>
        tx.mesa.findUnique({
          where: { id: datos.mesaId },
          select: {
            id: true,
            tenantId: true,
            restauranteId: true,
            numero: true,
            esVirtual: true,
            qrVersion: true,
          },
        }),
    );

    // Además de RLS, se compara el tenant de forma explícita. La mesa
    // virtual nunca tiene QR.
    if (mesa?.tenantId !== datos.tenantId || mesa.esVirtual) {
      throw new NotFoundException(MENSAJE_QR_INVALIDO);
    }

    if (datos.version < mesa.qrVersion) {
      throw new GoneException(MENSAJE_QR_REEMPLAZADO);
    }

    // Una versión mayor a la actual no la pudo generar el sistema.
    if (datos.version !== mesa.qrVersion) {
      throw new NotFoundException(MENSAJE_QR_INVALIDO);
    }

    return {
      tenantId: mesa.tenantId,
      mesaId: mesa.id,
      restauranteId: mesa.restauranteId,
      numero: mesa.numero,
    };
  }
}
