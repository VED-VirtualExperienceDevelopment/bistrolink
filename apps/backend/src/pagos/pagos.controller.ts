import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { PagosService } from './pagos.service';
import { CrearPagoDto } from './dto/crear-pago.dto';

@Controller('pedidos/:pedidoId/pagos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class PagosController {
  constructor(private readonly pagosService: PagosService) {}

  @Post()
  crear(@Req() req: { user: AuthenticatedUser }, @Body() dto: CrearPagoDto) {
    return this.pagosService.crear(req.user.tenantId, dto);
  }
}
