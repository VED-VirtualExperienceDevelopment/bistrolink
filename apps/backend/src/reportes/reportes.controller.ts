import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { FiltrosReportesDto } from './dto/filtros-reportes.dto';
import { ReportesService } from './reportes.service';

/**
 * HU-012 (BL-108): dashboard de reportes de ventas del establecimiento.
 * Solo ADMIN: MOZO y COCINA reciben 403, y sin token, 401.
 *
 * El establecimiento sale del token (tenantId), nunca de la ruta ni de los
 * filtros.
 */
@ApiTags('Reportes')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/reportes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  /**
   * Ventas por hora, platos más pedidos, ventas dentro y fuera del local y
   * rotación de mesas del período y el canal pedidos.
   */
  @Get()
  obtener(
    @Req() req: { user: AuthenticatedUser },
    @Query() filtros: FiltrosReportesDto,
  ) {
    return this.reportes.obtener(req.user.tenantId, filtros);
  }
}
