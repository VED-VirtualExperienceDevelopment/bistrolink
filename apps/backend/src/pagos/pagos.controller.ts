import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaQrGuard } from '../qr-mesa/mesa-qr.guard';
import { PedidoAccesoGuard } from '../pedidos/pedido-acceso.guard';
import { PagosService } from './pagos.service';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { ApiTags, ApiSecurity } from '@nestjs/swagger';
import {
  SEGURIDAD_KEYCLOAK,
  SEGURIDAD_MESA_QR,
  SEGURIDAD_PEDIDO,
} from '../openapi';
@ApiTags('Pagos')
// BL-311 (RD.05): token del comensal Y, según el pedido, el QR de la mesa o
// el token del pedido para retirar.
@ApiSecurity({ [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_MESA_QR]: [] })
@ApiSecurity({ [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_PEDIDO]: [] })
@Controller('pedidos/:pedidoId/pagos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class PagosController {
  constructor(private readonly pagosService: PagosService) {}

  // BL-311 (RD.05): solo quien hizo el pedido lo puede pagar (mesa del QR o
  // token de acceso del pedido para retirar; ver PedidoAccesoGuard).
  @Post()
  @UseGuards(MesaQrGuard, PedidoAccesoGuard)
  crear(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Body() dto: CrearPagoDto,
  ) {
    // El pedido es el de la ruta, que es el que validó PedidoAccesoGuard. El
    // del body es opcional (compatibilidad); si viene, tiene que coincidir.
    if (dto.pedidoId && dto.pedidoId !== pedidoId) {
      throw new BadRequestException(
        'El pedidoId del body no coincide con el de la ruta',
      );
    }
    return this.pagosService.crear(req.user.tenantId, { ...dto, pedidoId });
  }

  // BL-311: estado del pago y comprobante (serie, número y enlace de DGI)
  // para la pantalla del comensal, que lo consulta hasta que aparece el CFE.
  // Mismo control de acceso que el pago: sin endpoint público de datos
  // fiscales (RD.05).
  @Get()
  @UseGuards(MesaQrGuard, PedidoAccesoGuard)
  consultar(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
  ) {
    return this.pagosService.consultar(req.user.tenantId, pedidoId);
  }
}
