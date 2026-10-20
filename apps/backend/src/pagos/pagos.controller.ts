import {
  BadRequestException,
  Body,
  Controller,
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
}
