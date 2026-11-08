import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { SincronizacionPosService } from './sincronizacion-pos.service';
import { ImportacionVentasPosService } from './importacion-ventas-pos.service';
import {
  CambiarSincronizacionPosDto,
  ConsultarSincronizacionesPosDto,
  SimularVentaPosDto,
} from './dto/sincronizacion-pos.dto';

/**
 * HU-011 (BL-488): el administrador ve qué ventas llegaron al POS del local,
 * reintenta las que fallaron y activa o desactiva la sincronización. BL-489:
 * ve cuántas ventas del POS se trajeron y puede traerlas en el momento (o
 * simular una con el POS de prueba). Solo ADMIN.
 */
@ApiTags('POS del local')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/pos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class SincronizacionPosController {
  constructor(
    private readonly sincronizacion: SincronizacionPosService,
    private readonly importacion: ImportacionVentasPosService,
  ) {}

  @Get('sincronizaciones')
  listar(
    @Req() req: { user: AuthenticatedUser },
    @Query() filtros: ConsultarSincronizacionesPosDto,
  ) {
    return this.sincronizacion.listar(req.user.tenantId, filtros);
  }

  @Post('sincronizaciones/:id/reintentar')
  @HttpCode(HttpStatus.OK)
  reintentar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sincronizacion.reintentar(req.user.tenantId, id);
  }

  @Patch('configuracion')
  cambiarConfiguracion(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CambiarSincronizacionPosDto,
  ) {
    return this.sincronizacion.cambiarHabilitada(
      req.user.tenantId,
      req.user.sub,
      dto.habilitada,
    );
  }

  @Get('ventas')
  ventasDelPos(@Req() req: { user: AuthenticatedUser }) {
    return this.importacion.resumen(req.user.tenantId);
  }

  @Post('ventas/importar')
  @HttpCode(HttpStatus.OK)
  importar(@Req() req: { user: AuthenticatedUser }) {
    return this.importacion.importarAhora(req.user.tenantId);
  }

  @Post('ventas/simular')
  simular(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: SimularVentaPosDto,
  ) {
    return this.importacion.simularVenta(req.user.tenantId, dto);
  }
}
