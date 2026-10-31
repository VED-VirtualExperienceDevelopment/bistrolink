import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { MenuAdminService } from './menu-admin.service';
import { StorageService } from './storage.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CambiarDisponibilidadDto } from './dto/cambiar-disponibilidad.dto';
import { PresignedUrlDto } from './dto/presigned-url.dto';
import { ConfirmarImagenDto } from './dto/confirmar-imagen.dto';
import { ImagenesMenuService } from './imagenes-menu.service';
import { MenuAdminThrottlerGuard } from './menu-admin-throttler.guard';
import {
  LIMITE_CONFIRMACIONES_POR_MINUTO,
  LIMITE_SUBIDAS_POR_MINUTO,
} from './upload.constants';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SEGURIDAD_KEYCLOAK } from '../openapi';

@ApiTags('Menú (gestión)')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/menu')
@UseGuards(AuthGuard('jwt'), RolesGuard)
// BL-395: la carta la gestiona el ADMIN. El MOZO solo la ve y marca ítems
// como agotados o disponibles: esos dos métodos declaran su propio @Roles,
// que pisa al de la clase (getAllAndOverride en RolesGuard).
@Roles('ADMIN')
export class MenuAdminController {
  constructor(
    private readonly menuAdminService: MenuAdminService,
    private readonly storageService: StorageService,
    private readonly imagenesMenuService: ImagenesMenuService,
  ) {}

  /**
   * BL-386: URL de subida a la cuarentena. Solo ADMIN y con límite por
   * usuario: cada URL permite subir un archivo al bucket.
   */
  @Post('presigned-url')
  @Roles('ADMIN')
  @UseGuards(MenuAdminThrottlerGuard)
  @Throttle({ default: { limit: LIMITE_SUBIDAS_POR_MINUTO, ttl: 60_000 } })
  async getPresignedUrl(@Req() req: any, @Body() dto: PresignedUrlDto) {
    return this.storageService.urlFirmadaDeSubida(
      dto.contentType,
      dto.fileSize,
      req.user.tenantId,
    );
  }

  /**
   * BL-386: verifica y reprocesa la imagen subida a la cuarentena y
   * devuelve la key de la imagen publicada ({tenant}/menu/{uuid}.webp).
   * Solo ADMIN y con límite por usuario (procesar una imagen usa CPU).
   */
  @Post('imagenes/confirmar')
  @Roles('ADMIN')
  @UseGuards(MenuAdminThrottlerGuard)
  @Throttle({
    default: { limit: LIMITE_CONFIRMACIONES_POR_MINUTO, ttl: 60_000 },
  })
  async confirmarImagen(@Req() req: any, @Body() dto: ConfirmarImagenDto) {
    return this.imagenesMenuService.confirmar(dto.key, req.user.tenantId);
  }

  @Get('categoria')
  @Roles('ADMIN', 'MOZO')
  async findAllCategorias(
    @Req() req: any,
    @Query('incluirArchivados') incluirArchivados?: string,
  ) {
    const restauranteId = req.query.restauranteId as string;
    const keycloakId = req.user.sub;
    // BL-394: los archivados solo se listan si se piden (filtro «Archivados»).
    return this.menuAdminService.findAllCategorias(
      req.user.tenantId,
      restauranteId,
      keycloakId,
      incluirArchivados === 'true',
    );
  }

  @Post('categoria')
  async createCategoria(@Req() req: any, @Body() dto: CreateCategoriaDto) {
    const restauranteId = req.user.restauranteId;
    const keycloakId = req.user.sub;
    return this.menuAdminService.createCategoria(
      req.user.tenantId,
      restauranteId,
      keycloakId,
      dto,
    );
  }

  @Patch('categoria/:id')
  async updateCategoria(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoriaDto,
  ) {
    // BL-396: el actor de la auditoría es el sub del token.
    return this.menuAdminService.updateCategoria(
      req.user.tenantId,
      id,
      dto,
      req.user.sub,
    );
  }

  /** BL-394: archivar (baja lógica). 409 si le quedan ítems activos. */
  @Post('categoria/:id/archivar')
  @HttpCode(HttpStatus.OK)
  async archivarCategoria(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menuAdminService.archivarCategoria(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }

  @Post('categoria/:id/restaurar')
  @HttpCode(HttpStatus.OK)
  async restaurarCategoria(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menuAdminService.restaurarCategoria(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }

  /** BL-394: eliminación definitiva. 409 si la categoría tiene ítems. */
  @Delete('categoria/:id')
  async eliminarCategoria(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menuAdminService.eliminarCategoria(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }

  // BL-387: el actor de la auditoría es el sub del token, nunca el body.
  @Post('item')
  async createItem(@Req() req: any, @Body() dto: CreateItemDto) {
    return this.menuAdminService.createItem(
      req.user.tenantId,
      dto,
      req.user.sub,
    );
  }

  @Patch('item/:id')
  async updateItem(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menuAdminService.updateItem(
      req.user.tenantId,
      id,
      dto,
      req.user.sub,
    );
  }

  /**
   * BL-395: marcar un ítem como agotado o disponible. Es lo único de la
   * carta que también puede hacer el MOZO, durante el servicio.
   */
  @Patch('item/:id/disponibilidad')
  @Roles('ADMIN', 'MOZO')
  async cambiarDisponibilidad(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarDisponibilidadDto,
  ) {
    return this.menuAdminService.cambiarDisponibilidad(
      req.user.tenantId,
      id,
      dto.disponible,
      req.user.sub,
    );
  }

  /** BL-394: archivar (baja lógica); conserva el historial. */
  @Post('item/:id/archivar')
  @HttpCode(HttpStatus.OK)
  async archivarItem(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.menuAdminService.archivarItem(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }

  @Post('item/:id/restaurar')
  @HttpCode(HttpStatus.OK)
  async restaurarItem(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.menuAdminService.restaurarItem(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }

  /** BL-394: eliminación definitiva. 409 si el ítem tiene pedidos. */
  @Delete('item/:id')
  async eliminarItem(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.menuAdminService.eliminarItem(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }
}
