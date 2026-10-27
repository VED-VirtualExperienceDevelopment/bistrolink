import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import {
  exigirSesionAbierta,
  MesaDelQr,
  QrMesaAccesoService,
} from './qr-mesa-acceso.service';

/** Header con el token del QR de la mesa (el mismo de la URL /q/<token>). */
export const HEADER_MESA_TOKEN = 'x-mesa-token';
/** HU-017 (BL-60): sesión de la mesa que el comensal recibió con el menú. */
export const HEADER_MESA_SESION = 'x-mesa-sesion';

export interface RequestConMesaQr {
  user?: AuthenticatedUser;
  headers: Record<string, string | string[] | undefined>;
  mesaQr?: MesaDelQr;
}

/**
 * HU-034 (BL-204): ata un pedido o un llamado a la mesa del QR escaneado.
 *
 * El header es opcional a propósito: sin él, POST /pedidos es un pedido
 * para retirar (link web del local, canal WEB). Las rutas que solo tienen
 * sentido desde una mesa (POST /mesas/llamar) suman MesaQrObligatoriaGuard.
 *
 * Si la request trae el header X-Mesa-Token:
 * - el QR tiene que ser válido y vigente (QrMesaAccesoService: 404 / 410);
 * - la mesa tiene que ser del mismo tenant que el JWT del comensal (403);
 * - HU-017 (BL-60): la mesa tiene que tener la sesión abierta y el header
 *   X-Mesa-Sesion tiene que ser el de esa sesión (410 MESA_CERRADA /
 *   SESION_VENCIDA);
 * - la mesa queda en `request.mesaQr` (decorador @MesaDelQrActual): el
 *   endpoint usa ESA mesa, no la que diga el cliente.
 *
 * Va después de AuthGuard('jwt') y RolesGuard, porque necesita `request.user`.
 */
@Injectable()
export class MesaQrGuard implements CanActivate {
  constructor(private readonly qrMesaAcceso: QrMesaAccesoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConMesaQr>();
    const valor = request.headers[HEADER_MESA_TOKEN];

    if (valor === undefined) {
      return true;
    }

    // Un header repetido o vacío no es un token: no se intenta adivinar cuál usar.
    if (typeof valor !== 'string' || valor.length === 0) {
      throw new BadRequestException('X-Mesa-Token inválido');
    }

    const mesa = await this.qrMesaAcceso.resolver(valor);

    if (request.user?.tenantId !== mesa.tenantId) {
      throw new ForbiddenException(
        'El QR no corresponde a este establecimiento',
      );
    }

    const sesion = request.headers[HEADER_MESA_SESION];
    exigirSesionAbierta(mesa, typeof sesion === 'string' ? sesion : undefined);

    request.mesaQr = mesa;
    return true;
  }
}

/**
 * HU-034 (BL-204): para las rutas que SOLO tienen sentido desde una mesa
 * (POST /mesas/llamar). Va después de MesaQrGuard: si no vino X-Mesa-Token,
 * MesaQrGuard deja pasar y acá se corta con 400.
 *
 * 400 y no 401: el JWT del comensal es válido; lo que falta es el QR. Así el
 * frontend no lo confunde con una sesión vencida.
 */
@Injectable()
export class MesaQrObligatoriaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestConMesaQr>();

    if (!request.mesaQr) {
      throw new BadRequestException(
        'Falta X-Mesa-Token: escaneá el QR de la mesa',
      );
    }

    return true;
  }
}

/** La mesa del QR validada por MesaQrGuard, o undefined si no vino el header. */
export const MesaDelQrActual = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MesaDelQr | undefined =>
    context.switchToHttp().getRequest<RequestConMesaQr>().mesaQr,
);
