import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

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
