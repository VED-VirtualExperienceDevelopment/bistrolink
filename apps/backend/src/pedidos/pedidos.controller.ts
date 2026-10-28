import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import { MesaDelQrActual, MesaQrGuard } from '../qr-mesa/mesa-qr.guard';
import { PedidosService } from './pedidos.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { CrearPedidoMozoDto } from './dto/crear-pedido-mozo.dto';
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { SEGURIDAD_KEYCLOAK, SEGURIDAD_MESA_QR } from '../openapi';

@ApiTags('Pedidos')
// Pedido para retirar: solo el token del comensal. Pedido de mesa: además,
// el QR de la mesa (BL-204).
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@ApiSecurity({ [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_MESA_QR]: [] })
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

  // HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular, en
  // una mesa abierta. Solo MOZO y ADMIN (pisa el COMENSAL de la clase):
  // Cocina y Comensal reciben 403. El actor sale del token, nunca del body.
  @Post('mozo')
  @Roles('ADMIN', 'MOZO')
  crearPorMozo(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CrearPedidoMozoDto,
  ) {
    return this.pedidosService.crearPorMozo(
      req.user.tenantId,
      req.user.sub,
      dto,
    );
  }
}
