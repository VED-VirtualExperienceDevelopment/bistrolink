import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import { MesaDelQrActual, MesaQrGuard } from '../qr-mesa/mesa-qr.guard';
import { PedidosService } from './pedidos.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';

@Controller('pedidos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  // HU-034 (BL-204): con X-Mesa-Token, el pedido queda atado a la mesa del
  // QR (MesaQrGuard); sin él, es un pedido para retirar (canal WEB).
  @Post()
  @UseGuards(MesaQrGuard)
  crear(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CrearPedidoDto,
    @MesaDelQrActual() mesaQr?: MesaDelQr,
  ) {
    return this.pedidosService.crear(req.user.tenantId, dto, mesaQr);
  }
}
