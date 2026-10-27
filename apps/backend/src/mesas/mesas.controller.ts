import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import {
  MesaDelQrActual,
  MesaQrGuard,
  MesaQrObligatoriaGuard,
} from '../qr-mesa/mesa-qr.guard';
import { ListarLayoutQueryDto } from './dto/listar-layout-query.dto';
import { GuardarLayoutDto } from './dto/guardar-layout.dto';
import { MesaLayoutDto } from './dto/mesa-layout.dto';

@Controller('mesas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class MesasController {
  constructor(
    private readonly mesasService: MesasService,
    private readonly mesasQrService: MesasQrService,
  ) {}

  // HU-034 (BL-204): llamar al mozo desde la mesa del QR. La mesa sale
  // SOLO del X-Mesa-Token (obligatorio): no hay id en la URL que se pueda
  // cambiar. Orden de los guards:
  // 1. MesaQrGuard: valida el QR (404 / 410 / 403) y deja request.mesaQr.
  // 2. MesaQrObligatoriaGuard: 400 si no vino el header.
  // 3. MesaThrottlerGuard: 1 llamado por minuto por mesa del QR. Va último
  //    para que un token inválido no consuma el cupo de la mesa.
  @Post('llamar')
  @UseGuards(MesaQrGuard, MesaQrObligatoriaGuard, MesaThrottlerGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  llamarDesdeQr(
    @Req() req: { user: AuthenticatedUser },
    @MesaDelQrActual() mesaQr: MesaDelQr,
  ) {
    return this.mesasService.llamarMozo(req.user.tenantId, mesaQr);
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
      dto.plano,
    );
  }

  // HU-028 (BL-173): elementos fijos y zonas del plano del salón. Lo ven los
  // mismos roles que el mapa; solo ADMIN lo modifica (vía POST /mesas/layout).
  @Get('plano')
  @Roles('ADMIN', 'MOZO')
  obtenerPlano(
    @Req() req: { user: AuthenticatedUser },
    @Query() query: ListarLayoutQueryDto,
  ) {
    return this.mesasService.obtenerPlano(
      req.user.tenantId,
      query.restauranteId,
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

  // HU-017 (BL-60): sesión de la mesa. La abre y la cierra el mozo (o el
  // administrador) desde el mapa de mesas; cada cambio se emite por
  // WebSocket (mesa:estado_actualizado). Reemplazan al endpoint provisorio
  // PATCH /mesas/:id/estado de HU-016.
  @Post(':id/abrir')
  @Roles('ADMIN', 'MOZO')
  @HttpCode(HttpStatus.OK)
  abrirSesion(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
  ) {
    return this.mesasService.abrirSesion(req.user.tenantId, mesaId);
  }

  // 409 si hay un cobro en curso o pedidos sin entregar. Los pedidos que
  // esperaban el pago se cancelan; la respuesta dice cuántos.
  @Post(':id/cerrar')
  @Roles('ADMIN', 'MOZO')
  @HttpCode(HttpStatus.OK)
  cerrarSesion(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
  ) {
    return this.mesasService.cerrarSesion(
      req.user.tenantId,
      mesaId,
      req.user.sub,
    );
  }

  @Post(':id/limpia')
  @Roles('ADMIN', 'MOZO')
  @HttpCode(HttpStatus.OK)
  marcarLimpia(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
  ) {
    return this.mesasService.marcarLimpia(req.user.tenantId, mesaId);
  }
}
