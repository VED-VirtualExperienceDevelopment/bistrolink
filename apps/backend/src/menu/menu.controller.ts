import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  // HU-002: Acceso público al menú vía enlace web directo
  // Sin @UseGuards ni AuthGuard('jwt'): acceso público e intencional.
  // Criterio de aceptación de HU-002: "Funciona sin login ni instalación previa".
  // La única validación es que tenantId y restauranteId sean UUIDs válidos
  // y que la combinación exista bajo RLS (ver MenuService).

  @Get('tenant/:tenantId/restaurante/:restauranteId')
  getMenuPublico(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('restauranteId', ParseUUIDPipe) restauranteId: string,
  ) {
    return this.menuService.getMenuByRestaurante(tenantId, restauranteId);
  }

  // Sin @UseGuards ni AuthGuard('jwt'): acceso público e intencional.
  // Criterio de aceptación de HU-001: "funciona sin login ni instalación
  // previa". La única validación de identidad acá es que tenantId/mesaId
  // sean UUIDs válidos y que la combinación exista bajo RLS (ver MenuService).
  @Get(':tenantId/:mesaId')
  getMenu(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('mesaId', ParseUUIDPipe) mesaId: string,
  ) {
    return this.menuService.getMenuByMesa(tenantId, mesaId);
  }
}
