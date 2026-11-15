import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { FiltrosValoracionesDto } from './dto/filtros-valoraciones.dto';
import { ValoracionesService } from './valoraciones.service';

/**
 * HU-050 (BL-558): valoraciones de los clientes. Solo ADMIN: MOZO y COCINA
 * reciben 403, y sin token, 401. El establecimiento sale del token, nunca
 * de la ruta. No muestra el pedido ni la mesa de cada valoración.
 */
@ApiTags('Valoraciones')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/valoraciones')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class ValoracionesAdminController {
  constructor(private readonly valoraciones: ValoracionesService) {}

  @Get()
  listar(
    @Req() req: { user: AuthenticatedUser },
    @Query() filtros: FiltrosValoracionesDto,
  ) {
    return this.valoraciones.listar(req.user.tenantId, filtros);
  }
}
