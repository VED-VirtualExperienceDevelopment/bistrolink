import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { RequestConMesaQr } from '../qr-mesa/mesa-qr.guard';
import type { CanalInvitado } from '../auth-comensal/token-invitado';
import {
  HEADER_PEDIDO_TOKEN,
  tokenAccesoCoincide,
} from './token-acceso-pedido';
import { leerLinkPago } from '../link-pago/link-pago-token';
import {
  estadoDelLink,
  HEADER_LINK_PAGO,
  linkPermite,
  MENSAJE_LINK_INVALIDO,
  mensajeDelLink,
} from '../link-pago/link-pago';

interface RequestConPedido extends RequestConMesaQr {
  params?: Record<string, string | undefined>;
  method?: string;
}

/**
 * BL-311 (RD.05): solo quien hizo el pedido puede pagarlo y ver su
 * comprobante.
 *
 * El JWT del comensal es el mismo usuario técnico para todo el tenant
 * (comensal-<tenantId>): con él solo, un comensal de la mesa 3 podría pagar
 * o ver el CFE del pedido de la mesa 7 conociendo su id. Por eso:
 * - Pedido de mesa (canal QR): tiene que venir X-Mesa-Token y la mesa del QR
 *   tiene que ser la del pedido. BL-502 (RD.05): además, el pedido tiene que
 *   ser de la sesión abierta de la mesa (creado desde que se abrió); el de
 *   un grupo anterior en esa mesa responde 403.
 * - Pedido para retirar (canal WEB): tiene que venir X-Pedido-Token, el token
 *   que se devolvió al crear el pedido.
 * - HU-033 (BL-203): cualquier pedido, con X-Link-Pago, el link de pago que
 *   generó el mozo. Tiene que ser el link vigente de este pedido: para pagar,
 *   sin vencer; para consultar (GET), aunque haya vencido, así se puede
 *   seguir un pago que se estaba verificando.
 *
 * HU-052 (BL-580): con el token de invitado (trae `canal`), además el
 * pedido tiene que ser el del canal por el que se emitió:
 * - token del link de pago: solo su pedido (403 con cualquier otro, antes
 *   de buscarlo);
 * - token de una mesa: solo pedidos de mesa (403 con uno para retirar). La
 *   mesa y la sesión ya las ató MesaQrGuard;
 * - token del retiro: solo pedidos de su restaurante (403 con uno de otro
 *   restaurante del mismo establecimiento, aunque traiga su credencial).
 * Con el token de Keycloak (sin `canal`) todo sigue como antes.
 *
 * Va después de AuthGuardComensal, RolesGuard y MesaQrGuard: necesita
 * `request.user` y, si vino el QR, `request.mesaQr` ya validado.
 *
 * Errores: 400 si falta la credencial (no es una sesión vencida), 403 si no
 * corresponde y 404 si el pedido no existe en este tenant (RLS).
 */
/**
 * HU-052 (BL-580): el token de invitado usado con un pedido que no es de su
 * canal (el link de otro pedido, o el de una mesa con un pedido para
 * retirar).
 */
export const MENSAJE_PEDIDO_DE_OTRO_ACCESO = 'Este acceso no es de este pedido';

export const MENSAJE_PEDIDO_DE_OTRA_SESION =
  'Este pedido es de una sesión anterior de la mesa';

/**
 * BL-502: margen por diferencia de relojes. La apertura de la sesión la
 * fecha el backend y la creación del pedido, la base. Un grupo nuevo no
 * puede sentarse a la mesa 2 minutos después de un pedido del anterior: la
 * mesa se cierra con los pedidos entregados y pasa por limpieza.
 */
export const MARGEN_RELOJ_SESION_MS = 2 * 60 * 1000;

/**
 * BL-502: el pedido es de la sesión abierta de la mesa si se creó desde que
 * se abrió (con el margen de arriba). Sin fecha de apertura (sesión
 * anterior a la columna) no se puede saber: se deja pasar, como antes.
 */
export function esDeLaSesion(
  creadoEn: Date,
  sesionAbiertaEn: Date | null | undefined,
): boolean {
  if (!sesionAbiertaEn) return true;
  return (
    creadoEn.getTime() >= sesionAbiertaEn.getTime() - MARGEN_RELOJ_SESION_MS
  );
}

/**
 * HU-050 (BL-558): con el link de pago, un pedido ya pagado solo se puede
 * consultar. Una ruta marcada con este decorador acepta además, con el link
 * de un pedido pagado, una escritura: la valoración del pedido, que se hace
 * después de la entrega. No cambia nada para el QR ni para el token del
 * pedido para retirar.
 */
export const PERMITE_LINK_PAGADO = 'pedido-acceso:permite-link-pagado';
export const PermiteLinkPagado = () => SetMetadata(PERMITE_LINK_PAGADO, true);

/**
 * HU-052 (BL-580): el token del link de pago solo sirve para su pedido. Se
 * controla antes de buscar el pedido, así no se revela si existe.
 */
function exigirLinkDelPedido(
  canal: CanalInvitado | undefined,
  pedidoId: string,
): void {
  if (canal?.tipo === 'link' && canal.pedidoId !== pedidoId) {
    throw new ForbiddenException(MENSAJE_PEDIDO_DE_OTRO_ACCESO);
  }
}

/**
 * HU-052 (BL-580): el token de una mesa, solo con pedidos de mesa; el del
 * retiro, solo con pedidos de su restaurante.
 */
function exigirPedidoDelCanal(
  canal: CanalInvitado | undefined,
  pedido: { canal: string; restauranteId: string },
): void {
  const ajeno =
    (canal?.tipo === 'mesa' && pedido.canal !== 'QR') ||
    (canal?.tipo === 'retiro' && pedido.restauranteId !== canal.restauranteId);
  if (ajeno) {
    throw new ForbiddenException(MENSAJE_PEDIDO_DE_OTRO_ACCESO);
  }
}

/**
 * Pedido de mesa: el QR de esa mesa y, BL-502, de la sesión en la que se
 * hizo el pedido.
 */
function exigirMesaDelPedido(
  request: RequestConPedido,
  pedido: { mesaId: string; createdAt: Date },
): true {
  if (!request.mesaQr) {
    throw new BadRequestException(
      'Falta X-Mesa-Token: escaneá el QR de la mesa',
    );
  }
  if (request.mesaQr.mesaId !== pedido.mesaId) {
    throw new ForbiddenException('Este pedido es de otra mesa');
  }
  if (!esDeLaSesion(pedido.createdAt, request.mesaQr.sesionAbiertaEn)) {
    throw new ForbiddenException(MENSAJE_PEDIDO_DE_OTRA_SESION);
  }
  return true;
}

/** Pedido para retirar: el token que se devolvió al crearlo. */
function exigirTokenDelPedido(
  request: RequestConPedido,
  pedido: { accesoTokenHash: string | null },
): true {
  const token = request.headers[HEADER_PEDIDO_TOKEN];
  if (typeof token !== 'string' || token.length === 0) {
    throw new BadRequestException('Falta X-Pedido-Token');
  }
  if (!tokenAccesoCoincide(token, pedido.accesoTokenHash)) {
    throw new ForbiddenException('No tenés acceso a este pedido');
  }
  return true;
}

@Injectable()
export class PedidoAccesoGuard implements CanActivate {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    // Opcional: sin Reflector (tests que crean el guard a mano) ninguna ruta
    // acepta el link de un pedido pagado para escribir.
    @Optional() private readonly reflector?: Reflector,
  ) {}

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
    const canal = request.user?.canal;
    exigirLinkDelPedido(canal, pedidoId);

    const pedido = await this.tenantPrisma.runInTenantContext(tenantId, (tx) =>
      tx.pedido.findUnique({
        where: { id: pedidoId },
        select: {
          mesaId: true,
          restauranteId: true,
          canal: true,
          accesoTokenHash: true,
          createdAt: true,
          estado: true,
          linkPagoHash: true,
          linkPagoVenceEn: true,
        },
      }),
    );
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    exigirPedidoDelCanal(canal, pedido);

    const linkPago = request.headers[HEADER_LINK_PAGO];
    if (typeof linkPago === 'string' && linkPago.length > 0) {
      return this.validarLinkPago(
        linkPago,
        tenantId,
        pedidoId,
        pedido,
        request,
        this.permiteLinkPagado(context),
      );
    }

    return pedido.canal === 'QR'
      ? exigirMesaDelPedido(request, pedido)
      : exigirTokenDelPedido(request, pedido);
  }

  private permiteLinkPagado(context: ExecutionContext): boolean {
    return (
      this.reflector?.getAllAndOverride<boolean>(PERMITE_LINK_PAGADO, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  /** HU-033 (BL-203): el link tiene que ser el vigente de este pedido. */
  private validarLinkPago(
    token: string,
    tenantId: string,
    pedidoId: string,
    pedido: {
      estado: string;
      linkPagoHash: string | null;
      linkPagoVenceEn: Date | null;
    },
    request: RequestConPedido,
    permitePagado: boolean,
  ): true {
    const datos = leerLinkPago(token);
    if (datos?.tenantId !== tenantId || datos.pedidoId !== pedidoId) {
      throw new ForbiddenException(MENSAJE_LINK_INVALIDO);
    }
    const estado = estadoDelLink(pedido, datos.nonce, new Date());
    const soloLectura = (request.method ?? 'GET').toUpperCase() === 'GET';
    // HU-050 (BL-558): la ruta marcada acepta el link de un pedido pagado
    // como si fuera una consulta (sigue sin aceptar reemplazado, cancelado
    // ni caducado).
    const comoConsulta = soloLectura || (permitePagado && estado === 'pagado');
    if (!linkPermite(estado, comoConsulta)) {
      throw new ForbiddenException(mensajeDelLink(estado));
    }
    return true;
  }
}
