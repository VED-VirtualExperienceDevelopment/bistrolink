import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { ComprobantesService } from './comprobantes.service';
import { ConsultarComprobantesDto } from './dto/consultar-comprobantes.dto';

/**
 * HU-009 (BL-455): el administrador consulta los comprobantes fiscales de
 * su establecimiento y su estado ante la DGI. Solo lectura y solo ADMIN.
 */
@ApiTags('Comprobantes fiscales')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/comprobantes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Get()
  consultar(
    @Req() req: { user: AuthenticatedUser },
    @Query() filtros: ConsultarComprobantesDto,
  ) {
    return this.comprobantes.consultar(req.user.tenantId, filtros);
  }
}
