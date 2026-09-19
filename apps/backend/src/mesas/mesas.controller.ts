import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaThrottlerGuard } from './mesa-throttler.guard';
import { MesasService } from './mesas.service';
import { ListarLayoutQueryDto } from './dto/listar-layout-query.dto';
import { GuardarLayoutDto } from './dto/guardar-layout.dto';
import { MesaLayoutDto } from './dto/mesa-layout.dto';
import { ActualizarEstadoMesaDto } from './dto/actualizar-estado-mesa.dto';

@Controller('mesas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class MesasController {
  constructor(private readonly mesasService: MesasService) {}

  @Post(':id/llamar')
  @UseGuards(MesaThrottlerGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  llamar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
  ) {
    return this.mesasService.llamarMozo(req.user.tenantId, mesaId);
  }

  // HU-016: mapa visual de mesas. A diferencia de "llamar" (COMENSAL), estas
  // rutas son de gestión — @Roles a nivel de método pisa el @Roles('COMENSAL')
  // de la clase (mismo mecanismo ya usado en MenuController para mezclar
  // rutas públicas y de administración en un solo controller).
  @Get('layout')
  @Roles('ADMIN', 'MOZO')
  obtenerLayout(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListarLayoutQueryDto,
  ) {
    return this.mesasService.obtenerLayout(
      req.user.tenantId,
      query.restauranteId,
    );
  }

  @Post('layout')
  @Roles('ADMIN')
  guardarLayout(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: GuardarLayoutDto,
  ) {
    return this.mesasService.guardarLayout(
      req.user.tenantId,
      dto.restauranteId,
      dto.mesas,
    );
  }

  @Put(':id')
  @Roles('ADMIN')
  actualizarLayoutMesa(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
    @Body() dto: MesaLayoutDto,
  ) {
    return this.mesasService.actualizarLayoutMesa(
      req.user.tenantId,
      mesaId,
      dto,
    );
  }

  // PROVISORIO (HU-016 → HU-017): ver ActualizarEstadoMesaDto. Se elimina o
  // se restringe más (ej. a un rol de sistema) cuando HU-017 dispare estos
  // cambios directamente desde el flujo de pedidos/pagos.
  @Patch(':id/estado')
  @Roles('ADMIN')
  actualizarEstado(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
    @Body() dto: ActualizarEstadoMesaDto,
  ) {
    return this.mesasService.actualizarEstado(
      req.user.tenantId,
      mesaId,
      dto.estado,
    );
  }
}
