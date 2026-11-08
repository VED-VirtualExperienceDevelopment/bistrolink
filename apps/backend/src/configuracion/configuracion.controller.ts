import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { ConfiguracionEstablecimientoService } from './configuracion-establecimiento.service';
import { ActualizarConfiguracionDto } from './dto/actualizar-configuracion.dto';
import { AnonimizarReceptorService } from './anonimizar-receptor.service';
import { AnonimizarReceptorDto } from './dto/anonimizar-receptor.dto';

/**
 * HU-020 (BL-72): el Administrador consulta y cambia la configuración de su
 * establecimiento (razón social, medios de pago, propinas sugeridas y
 * proveedor de CFE). Solo ADMIN: el MOZO no la ve ni la cambia.
 *
 * El establecimiento sale del token (tenantId), nunca de la ruta ni del
 * body; el actor de la auditoría es el sub del token.
 */
@ApiTags('Configuración del establecimiento')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/configuracion')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class ConfiguracionController {
  constructor(
    private readonly configuracion: ConfiguracionEstablecimientoService,
    private readonly anonimizarReceptor: AnonimizarReceptorService,
  ) {}

  @Get()
  obtener(@Req() req: { user: AuthenticatedUser }) {
    return this.configuracion.obtener(req.user.tenantId);
  }

  /** Cambia lo que viene en el body y devuelve la configuración completa. */
  @Patch()
  actualizar(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: ActualizarConfiguracionDto,
  ) {
    return this.configuracion.actualizar(req.user.tenantId, dto, {
      id: req.user.sub,
    });
  }

  /**
   * HU-009 (BL-453): anonimiza el RUT y la razón social de la e-Factura en
   * los pedidos del local con ese RUT. Los CFE y los montos no cambian.
   */
  @Post('privacidad/anonimizar-receptor')
  @HttpCode(HttpStatus.OK)
  anonimizar(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: AnonimizarReceptorDto,
  ) {
    return this.anonimizarReceptor.anonimizar(req.user.tenantId, dto.rut, {
      id: req.user.sub,
    });
  }
}
