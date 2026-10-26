import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
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

  @Post()
  crear(@Req() req: { user: AuthenticatedUser }, @Body() dto: CrearPagoDto) {
    return this.pagosService.crear(req.user.tenantId, dto);
  }
}
