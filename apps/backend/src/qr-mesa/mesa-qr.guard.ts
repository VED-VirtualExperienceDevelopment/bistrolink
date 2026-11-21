import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  GoneException,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import type { CanalInvitado } from '../auth-comensal/token-invitado';
import {
  CODIGO_SESION_VENCIDA,
  exigirSesionAbierta,
  MENSAJE_SESION_VENCIDA,
  MesaDelQr,
  QrMesaAccesoService,
} from './qr-mesa-acceso.service';

/** Header con el token del QR de la mesa (el mismo de la URL /q/<token>). */
export const HEADER_MESA_TOKEN = 'x-mesa-token';
/** HU-017 (BL-60): sesión de la mesa que el comensal recibió con el menú. */
export const HEADER_MESA_SESION = 'x-mesa-sesion';

/** HU-052 (BL-580): mensajes del token de invitado usado fuera de su canal. */
export const MENSAJE_FALTA_QR = 'Falta X-Mesa-Token: escaneá el QR de la mesa';
export const MENSAJE_ACCESO_NO_ES_DE_MESA =
  'Este acceso no es de una mesa: escaneá el QR de la mesa';
export const MENSAJE_ACCESO_DE_OTRA_MESA = 'Este acceso es de otra mesa';

/**
 * HU-052 (BL-580): el token de invitado de una mesa lleva la mesa y la
 * sesión por las que se emitió. Solo sirve con el QR de esa mesa y mientras
 * esa sesión siga abierta: cerrar la mesa (o abrir una sesión nueva) deja
 * inservible el token del grupo anterior. Se llama después de
 * exigirSesionAbierta, que ya cubrió la mesa cerrada (410 MESA_CERRADA).
 */
export function exigirMesaDelToken(
  canal: Extract<CanalInvitado, { tipo: 'mesa' }>,
  mesa: MesaDelQr,
): void {
  if (canal.mesaId !== mesa.mesaId) {
    throw new ForbiddenException(MENSAJE_ACCESO_DE_OTRA_MESA);
  }
  if (canal.sesionId !== mesa.sesionId) {
    // El mismo 410 que una página vieja: el frontend ya pide escanear de nuevo.
    throw new GoneException({
      statusCode: 410,
      codigo: CODIGO_SESION_VENCIDA,
      message: MENSAJE_SESION_VENCIDA,
    });
  }
}

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
 * HU-052 (BL-580): con el token de invitado (trae `canal`), además:
 * - token de una mesa: el header es obligatorio (400 sin él) y la mesa y la
 *   sesión del QR tienen que ser las del token (403 otra mesa, 410 otra
 *   sesión);
 * - token del retiro o del link de pago: no sirve con un QR de mesa (403).
 * Con el token de Keycloak (sin `canal`) todo sigue como antes.
 *
 * Va después de AuthGuardComensal y RolesGuard, porque necesita `request.user`.
 */
@Injectable()
export class MesaQrGuard implements CanActivate {
  constructor(private readonly qrMesaAcceso: QrMesaAccesoService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestConMesaQr>();
    const valor = request.headers[HEADER_MESA_TOKEN];
    const canal = request.user?.canal;

    if (valor === undefined) {
      // HU-052 (BL-580): el token de una mesa no sirve para pedir «para
      // retirar» ni para nada fuera de esa mesa.
      if (canal?.tipo === 'mesa') {
        throw new BadRequestException(MENSAJE_FALTA_QR);
      }
      return true;
    }

    // Un header repetido o vacío no es un token: no se intenta adivinar cuál usar.
    if (typeof valor !== 'string' || valor.length === 0) {
      throw new BadRequestException('X-Mesa-Token inválido');
    }

    // HU-052 (BL-580): el token del retiro o del link de pago no se usa en
    // una mesa. Se corta antes de resolver el QR.
    if (canal && canal.tipo !== 'mesa') {
      throw new ForbiddenException(MENSAJE_ACCESO_NO_ES_DE_MESA);
    }

    const mesa = await this.qrMesaAcceso.resolver(valor);

    if (request.user?.tenantId !== mesa.tenantId) {
      throw new ForbiddenException(
        'El QR no corresponde a este establecimiento',
      );
    }

    const sesion = request.headers[HEADER_MESA_SESION];
    exigirSesionAbierta(mesa, typeof sesion === 'string' ? sesion : undefined);
    if (canal?.tipo === 'mesa') {
      exigirMesaDelToken(canal, mesa);
    }

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
      throw new BadRequestException(MENSAJE_FALTA_QR);
    }

    return true;
  }
}

/** La mesa del QR validada por MesaQrGuard, o undefined si no vino el header. */
export const MesaDelQrActual = createParamDecorator(
  (_data: unknown, context: ExecutionContext): MesaDelQr | undefined =>
    context.switchToHttp().getRequest<RequestConMesaQr>().mesaQr,
);
