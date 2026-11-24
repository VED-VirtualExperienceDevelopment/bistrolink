import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuardComensal } from '../auth/invitado-jwt.strategy';
import { Throttle } from '@nestjs/throttler';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaQrGuard } from '../qr-mesa/mesa-qr.guard';
import {
  PedidoAccesoGuard,
  PermiteLinkPagado,
} from '../pedidos/pedido-acceso.guard';
import {
  SEGURIDAD_KEYCLOAK,
  SEGURIDAD_MESA_QR,
  SEGURIDAD_PEDIDO,
} from '../openapi';
import { ValorarPedidoDto } from './dto/valorar-pedido.dto';
import {
  LIMITE_VALORACIONES_POR_PEDIDO,
  ValoracionThrottlerGuard,
} from './valoracion-throttler.guard';
import { ValoracionesService } from './valoraciones.service';

/**
 * HU-050 (BL-558): el comensal valora su pedido (1 a 5 y un comentario
 * opcional) después de la entrega. Mismo control de acceso que el pago
 * (RD.05): el QR de la mesa del pedido, el token del pedido para retirar o
 * el link de pago, que acá sirve aunque el pedido ya esté pagado.
 *
 * 201 si se guardó; 409 si todavía no se entregó o si ya se valoró
 * (codigo YA_VALORADO); 429 si se pasa del límite de envíos.
 */
@ApiTags('Valoraciones')
@ApiSecurity({ [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_MESA_QR]: [] })
@ApiSecurity({ [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_PEDIDO]: [] })
@Controller('pedidos/:pedidoId/valoracion')
// HU-052 (BL-578): acepta el token de invitado del comensal y el de Keycloak.
@UseGuards(AuthGuardComensal, RolesGuard)
@Roles('COMENSAL')
export class ValoracionPedidoController {
  constructor(private readonly valoraciones: ValoracionesService) {}

  @Post()
  @PermiteLinkPagado()
  @UseGuards(ValoracionThrottlerGuard, MesaQrGuard, PedidoAccesoGuard)
  @Throttle({
    default: { limit: LIMITE_VALORACIONES_POR_PEDIDO, ttl: 60_000 },
  })
  valorar(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Body() dto: ValorarPedidoDto,
  ) {
    return this.valoraciones.valorar(req.user.tenantId, pedidoId, dto);
  }
}
