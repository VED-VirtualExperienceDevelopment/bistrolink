import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { AuthenticatedUser } from '../../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../../openapi';
import { CobroEfectivoService } from './cobro-efectivo.service';
import { RegistrarCobroEfectivoDto } from './registrar-cobro-efectivo.dto';
import { RegistrarCobroPosDto } from '../pos/registrar-cobro-pos.dto';

/**
 * HU-031 (BL-201): cobros que registra el staff del local, en efectivo o
 * (HU-007b, BL-80) con el POS del local. Solo el mozo (colaborador) y el
 * administrador; Cocina y Comensal reciben 403.
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

  /**
   * HU-007b (BL-80): registra un cobro hecho con el POS del local (crédito o
   * débito) con el número de autorización del voucher: el pedido pasa a
   * cocina y se pide el CFE. 409 si el POS no está habilitado, el pedido ya
   * se pagó o hay un pago con tarjeta en curso.
   */
  @Post('pos')
  registrarPos(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: RegistrarCobroPosDto,
  ) {
    return this.cobroEfectivo.registrarPos(
      req.user.tenantId,
      req.user.sub,
      dto,
    );
  }
}
