import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { QrMesaTokenService } from './qr-mesa-token.service';

/** La mesa a la que corresponde un QR válido y vigente. */
export interface MesaDelQr {
  tenantId: string;
  mesaId: string;
  restauranteId: string;
  numero: number;
  /** HU-017 (BL-60): sesión abierta de la mesa, o null si está cerrada. */
  sesionId: string | null;
}

//Mismo mensaje para cualquier cosa que no sea un QR válido (formato, firma, mesa
// inexistente o virtual): no se distingue el motivo.
export const MENSAJE_QR_INVALIDO = 'QR no válido';
export const MENSAJE_QR_REEMPLAZADO =
  'Este QR fue reemplazado. Pedile al personal el QR actualizado de la mesa.';

// HU-017 (BL-60): el QR es válido pero no se puede usar para pedir. Van con
// un `codigo` para que el frontend muestre la pantalla que corresponde.
export const CODIGO_MESA_CERRADA = 'MESA_CERRADA';
export const CODIGO_SESION_VENCIDA = 'SESION_VENCIDA';
export const MENSAJE_MESA_CERRADA =
  'Esta mesa está cerrada. Pedile al mozo que la abra para hacer tu pedido.';
export const MENSAJE_SESION_VENCIDA =
  'La sesión de esta mesa terminó. Escaneá de nuevo el QR de la mesa.';

/**
 * HU-017 (BL-60): el QR solo sirve con la sesión de la mesa abierta, y la
 * página del comensal tiene que ser de ESA sesión (la recibió al abrir el
 * menú). 410 en los dos casos: el acceso «ya no existe», igual que un QR
 * reemplazado.
 */
export function exigirSesionAbierta(
  mesa: MesaDelQr,
  sesionDelComensal?: string,
): void {
  if (!mesa.sesionId) {
    throw new GoneException({
      statusCode: 410,
      codigo: CODIGO_MESA_CERRADA,
      message: MENSAJE_MESA_CERRADA,
    });
  }
  if (sesionDelComensal !== mesa.sesionId) {
    throw new GoneException({
      statusCode: 410,
      codigo: CODIGO_SESION_VENCIDA,
      message: MENSAJE_SESION_VENCIDA,
    });
  }
}

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
            sesionId: true,
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
      sesionId: mesa.sesionId,
    };
  }
}
