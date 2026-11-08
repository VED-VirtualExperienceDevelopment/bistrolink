import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { AuditoriaConsultaService } from './auditoria-consulta.service';
import { ConsultarAuditoriaDto } from './dto/consultar-auditoria.dto';

/**
 * HU-035 (BL-205): el administrador consulta quién hizo cada acción
 * sensible y cuándo. Solo lectura: no hay endpoints para modificar ni
 * borrar registros.
 */
@ApiTags('Auditoría')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('auditoria')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class AuditoriaController {
  constructor(private readonly consulta: AuditoriaConsultaService) {}

  @Get()
  consultar(
    @Req() req: { user: AuthenticatedUser },
    @Query() filtros: ConsultarAuditoriaDto,
  ) {
    return this.consulta.consultar(req.user.tenantId, filtros);
  }
}
