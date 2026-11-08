import {
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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../../auth/roles.guard';
import { AuthenticatedUser } from '../../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../../openapi';
import { CancelacionPedidoService } from './cancelacion-pedido.service';
import { CancelarPedidoDto } from './cancelar-pedido.dto';

/**
 * HU-024 (BL-104): cancelación de un pedido pagado. Solo el mozo
 * (colaborador) y el administrador; Cocina y Comensal reciben 403.
 */
@ApiTags('Cancelación de pedidos')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('pedidos/:pedidoId/cancelacion')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MOZO')
export class CancelacionPedidoController {
  constructor(private readonly cancelacion: CancelacionPedidoService) {}

  /** Qué se devuelve y por qué medio, antes de confirmar. */
  @Get()
  vistaPrevia(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
  ) {
    return this.cancelacion.vistaPrevia(req.user.tenantId, pedidoId);
  }

  /**
   * Cancela el pedido entero y devuelve el pago. 409 si el pedido no está
   * recibido ni en preparación; 400 si falta confirmar la devolución manual;
   * 502 si Mercado Pago no reembolsó (el pedido no se cancela).
   */
  @Post()
  cancelar(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Body() dto: CancelarPedidoDto,
  ) {
    return this.cancelacion.cancelar(
      req.user.tenantId,
      req.user.sub,
      pedidoId,
      dto,
    );
  }
}
