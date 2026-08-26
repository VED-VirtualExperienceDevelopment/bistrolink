import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { PedidosService } from './pedidos.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';

@Controller('pedidos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class PedidosController {
  constructor(private readonly pedidosService: PedidosService) {}

  @Post()
  crear(@Req() req: { user: AuthenticatedUser }, @Body() dto: CrearPedidoDto) {
    return this.pedidosService.crear(req.user.tenantId, dto);
  }
}
