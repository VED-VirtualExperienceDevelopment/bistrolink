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
import { MesasQrService } from './mesas-qr.service';
import { ListarLayoutQueryDto } from './dto/listar-layout-query.dto';
import { GuardarLayoutDto } from './dto/guardar-layout.dto';
import { MesaLayoutDto } from './dto/mesa-layout.dto';
import { ActualizarEstadoMesaDto } from './dto/actualizar-estado-mesa.dto';

@Controller('mesas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class MesasController {
  constructor(
    private readonly mesasService: MesasService,
    private readonly mesasQrService: MesasQrService,
  ) {}

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
      dto.eliminar ?? [],
    );
  }

  // HU-034 (BL-204): URLs de los QR de cada mesa (y del link web del local)
  // para armar el PDF imprimible. Solo ADMIN.
  @Get('qr')
  @Roles('ADMIN')
  listarQr(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListarLayoutQueryDto,
  ) {
    return this.mesasQrService.listar(req.user.tenantId, query.restauranteId);
  }

  // HU-034 (BL-204): regenera el QR de una mesa (por ejemplo, si se filtró).
  // El anterior deja de funcionar. Solo ADMIN. 200 y no 201: no crea un
  // recurso nuevo.
  @Post(':id/qr/regenerar')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  regenerarQr(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
  ) {
    return this.mesasQrService.regenerar(
      req.user.tenantId,
      mesaId,
      req.user.sub,
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
