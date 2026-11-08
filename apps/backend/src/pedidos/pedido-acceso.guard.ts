import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestConMesaQr } from '../qr-mesa/mesa-qr.guard';
import {
  HEADER_PEDIDO_TOKEN,
  tokenAccesoCoincide,
} from './token-acceso-pedido';

interface RequestConPedido extends RequestConMesaQr {
  params?: Record<string, string | undefined>;
}

/**
 * BL-311 (RD.05): solo quien hizo el pedido puede pagarlo y ver su
 * comprobante.
 *
 * El JWT del comensal es el mismo usuario técnico para todo el tenant
 * (comensal-<tenantId>): con él solo, un comensal de la mesa 3 podría pagar
 * o ver el CFE del pedido de la mesa 7 conociendo su id. Por eso:
 * - Pedido de mesa (canal QR): tiene que venir X-Mesa-Token y la mesa del QR
 *   tiene que ser la del pedido.
 * - Pedido para retirar (canal WEB): tiene que venir X-Pedido-Token, el token
 *   que se devolvió al crear el pedido.
 *
 * Va después de AuthGuard('jwt'), RolesGuard y MesaQrGuard: necesita
 * `request.user` y, si vino el QR, `request.mesaQr` ya validado.
 *
 * Errores: 400 si falta la credencial (no es una sesión vencida), 403 si no
 * corresponde y 404 si el pedido no existe en este tenant (RLS).
 */
@Injectable()
export class PedidoAccesoGuard implements CanActivate {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConPedido>();
    const pedidoId = request.params?.pedidoId;
    const tenantId = request.user?.tenantId;

    if (!pedidoId || !isUUID(pedidoId)) {
      throw new BadRequestException('pedidoId debe tener formato UUID');
    }
    if (!tenantId) {
      // No debería pasar: AuthGuard('jwt') corre antes. Denegación por defecto.
      throw new ForbiddenException('No tenés acceso a este pedido');
    }

    const pedido = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.pedido.findUnique({
        where: { id: pedidoId },
        select: { mesaId: true, canal: true, accesoTokenHash: true },
      }),
    );
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (pedido.canal === 'QR') {
      if (!request.mesaQr) {
        throw new BadRequestException(
          'Falta X-Mesa-Token: escaneá el QR de la mesa',
        );
      }
      if (request.mesaQr.mesaId !== pedido.mesaId) {
        throw new ForbiddenException('Este pedido es de otra mesa');
      }
      return true;
    }

    const token = request.headers[HEADER_PEDIDO_TOKEN];
    if (typeof token !== 'string' || token.length === 0) {
      throw new BadRequestException('Falta X-Pedido-Token');
    }
    if (!tokenAccesoCoincide(token, pedido.accesoTokenHash)) {
      throw new ForbiddenException('No tenés acceso a este pedido');
    }
    return true;
  }
}
