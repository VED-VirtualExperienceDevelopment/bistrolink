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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { MenuAdminService } from './menu-admin.service';
import { StorageService } from './storage.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
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
@Roles('ADMIN', 'MOZO')
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
    return this.storageService.getPresignedPostUrl(
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
  async findAllCategorias(@Req() req: any) {
    const restauranteId = req.query.restauranteId as string;
    const keycloakId = req.user.sub;
    return this.menuAdminService.findAllCategorias(
      req.user.tenantId,
      restauranteId,
      keycloakId,
    );
  }

  @Post('categoria')
  async createCategoria(
    @Req() req: any,
    @Body() body: { nombre: string; orden?: number },
  ) {
    const restauranteId = req.user.restauranteId;
    const keycloakId = req.user.sub;
    return this.menuAdminService.createCategoria(
      req.user.tenantId,
      restauranteId,
      keycloakId,
      body,
    );
  }

  @Patch('categoria/:id')
  async updateCategoria(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoriaDto,
  ) {
    return this.menuAdminService.updateCategoria(req.user.tenantId, id, dto);
  }

  @Delete('categoria/:id')
  async deleteCategoria(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.menuAdminService.deleteCategoria(req.user.tenantId, id);
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

  @Delete('item/:id')
  async deleteItem(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    // HU-035 (BL-205): el actor de la auditoría es el sub del token.
    return this.menuAdminService.deleteItem(
      req.user.tenantId,
      id,
      req.user.sub,
    );
  }
}
