import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { AuthenticatedUser } from '../../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../../openapi';
import { CobroEfectivoService } from './cobro-efectivo.service';
import { RegistrarCobroEfectivoDto } from './registrar-cobro-efectivo.dto';

/**
 * HU-031 (BL-201): cobros que registra el staff del local. Solo el mozo
 * (colaborador) y el administrador; Cocina y Comensal reciben 403.
 */
@ApiTags('Cobros')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('cobros')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MOZO')
export class CobrosController {
  constructor(private readonly cobroEfectivo: CobroEfectivoService) {}

  /** Pedidos que esperan el pago, de las mesas y para retirar. */
  @Get('pendientes')
  pendientes(@Req() req: { user: AuthenticatedUser }) {
    return this.cobroEfectivo.pendientes(req.user.tenantId);
  }

  /**
   * Registra el cobro en efectivo: el pedido pasa a cocina y se pide el CFE.
   * 409 si el efectivo está deshabilitado, el pedido ya se pagó o hay un pago
   * con tarjeta en curso; 400 si el monto recibido no alcanza.
   */
  @Post('efectivo')
  registrarEfectivo(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: RegistrarCobroEfectivoDto,
  ) {
    return this.cobroEfectivo.registrar(req.user.tenantId, req.user.sub, dto);
  }
}
