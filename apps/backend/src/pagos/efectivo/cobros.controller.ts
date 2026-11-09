import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { AuthenticatedUser } from '../../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../../openapi';
import { CobroEfectivoService } from './cobro-efectivo.service';
import { CancelacionPendienteService } from './cancelacion-pendiente.service';
import { RegistrarCobroEfectivoDto } from './registrar-cobro-efectivo.dto';
import { RegistrarCobroPosDto } from '../pos/registrar-cobro-pos.dto';

/**
 * HU-031 (BL-201): cobros que registra el staff del local, en efectivo o
 * (HU-007b, BL-80) con el POS del local, y (BL-501) la cancelación de un
 * pedido que todavía no se cobró. Solo el mozo (colaborador) y el
 * administrador; Cocina y Comensal reciben 403.
 */
@ApiTags('Cobros')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('cobros')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MOZO')
export class CobrosController {
  constructor(
    private readonly cobroEfectivo: CobroEfectivoService,
    private readonly cancelacion: CancelacionPendienteService,
  ) {}

  /** Pedidos que esperan el pago, de las mesas y para retirar. */
  @Get('pendientes')
  pendientes(@Req() req: { user: AuthenticatedUser }) {
    return this.cobroEfectivo.pendientes(req.user.tenantId);
  }

  /**
   * BL-501: cancela un pedido que todavía no se cobró (el comensal se
   * arrepintió o se cargó por error). 404 si no es del establecimiento; 409
   * si ya se cobró, ya estaba cancelado o hay un pago con tarjeta en curso.
   */
  @Post('pendientes/:pedidoId/cancelar')
  @HttpCode(HttpStatus.OK)
  cancelarPendiente(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', new ParseUUIDPipe()) pedidoId: string,
  ) {
    return this.cancelacion.cancelar(req.user.tenantId, req.user.sub, pedidoId);
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
