import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { MenuAdminService } from './menu-admin.service';
import { StorageService } from './storage.service';
import { UpdateItemDto } from './dto/update-item.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';
import { PresignedUrlDto } from './dto/presigned-url.dto';

@Controller('admin/menu')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MOZO')
export class MenuAdminController {
  constructor(
    private readonly menuAdminService: MenuAdminService,
    private readonly storageService: StorageService,
  ) {}

  // ── STORAGE ─────────────────────────────────────────────────────────────────

  @Post('presigned-url')
  async getPresignedUrl(@Req() req: any, @Body() dto: PresignedUrlDto) {
    return this.storageService.getPresignedPostUrl(
      dto.fileName,
      dto.contentType,
      req.user.tenantId,
    );
  }

  // ── CATEGORÍAS ──────────────────────────────────────────────────────────────

  @Get('categoria')
  async findAllCategorias(@Req() req: any) {
    const restauranteId = req.query.restauranteId as string;
    const keycloakId = req.user.sub; // El ID único del usuario en Keycloak
    return this.menuAdminService.findAllCategorias(req.user.tenantId, restauranteId, keycloakId);
  }

  @Post('categoria')
  async createCategoria(@Req() req: any, @Body() body: { nombre: string; orden?: number }) {
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

  // ── ÍTEMS ───────────────────────────────────────────────────────────────────

  @Post('item')
  async createItem(
    @Req() req: any,
    @Body() body: { categoriaId: string; nombre: string; precio: string; descripcion?: string; disponible?: boolean; imagenKey?: string }
  ) {
    return this.menuAdminService.createItem(req.user.tenantId, body);
  }

  @Patch('item/:id')
  async updateItem(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.menuAdminService.updateItem(req.user.tenantId, id, dto);
  }
}
