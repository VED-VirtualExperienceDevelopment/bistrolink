import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuardComensal } from '../auth/invitado-jwt.strategy';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { exigirCanalParaResumenDelLink } from '../auth-comensal/canal-invitado';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { HEADER_LINK_PAGO, MENSAJE_LINK_INVALIDO } from './link-pago';
import { LinkPagoService } from './link-pago.service';
import { GenerarLinkPagoDto } from './dto/generar-link-pago.dto';

/**
 * HU-033 (BL-203): link de pago.
 * - El mozo o el administrador lo genera desde «Cobros pendientes».
 * - El comensal, con el JWT que obtiene en POST /auth/comensal/link-pago,
 *   ve el pedido antes de pagar.
 */
@ApiTags('Link de pago')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller()
// HU-052 (BL-578): acepta el token de invitado del comensal y el de Keycloak.
@UseGuards(AuthGuardComensal, RolesGuard)
export class LinkPagoController {
  constructor(private readonly linkPago: LinkPagoService) {}

  @Post('cobros/pendientes/:pedidoId/link-pago')
  @Roles('ADMIN', 'MOZO')
  @HttpCode(HttpStatus.OK)
  generar(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', new ParseUUIDPipe()) pedidoId: string,
    @Body() dto: GenerarLinkPagoDto = {},
  ) {
    return this.linkPago.generar({
      tenantId: req.user.tenantId,
      keycloakId: req.user.sub,
      pedidoId,
      reemplazar: dto.reemplazar === true,
    });
  }

  @Get('link-pago')
  @Roles('COMENSAL')
  resumen(
    @Req() req: { user: AuthenticatedUser },
    @Headers(HEADER_LINK_PAGO) token: string | undefined,
  ) {
    if (!token) throw new NotFoundException(MENSAJE_LINK_INVALIDO);
    // HU-052 (BL-580): con el token de invitado, solo el de este link.
    exigirCanalParaResumenDelLink(req.user, token);
    return this.linkPago.resumen(req.user.tenantId, token);
  }
}
