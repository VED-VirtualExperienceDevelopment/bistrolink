import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  /**
   * HU-002: Acceso público al menú vía enlace web directo.
   *
   * SEGURIDAD: Este endpoint es PÚBLICO por diseño (sin @UseGuards ni AuthGuard).
   *
   * Capas de defensa (defensa en profundidad):
   * 1. ParseUUIDPipe: valida que tenantId y restauranteId sean UUIDs válidos (previene inyección)
   * 2. runInTenantContext: establece contexto de tenant a nivel de transacción
   * 3. RLS: filtra filas a nivel de base de datos (segunda línea de defensa)
   * 4. Validación de existencia: devuelve 404 genérico (no revela si el recurso existe en otro tenant)
   *
   * Threat model:
   * - Attacker con URL válida: puede ver el menú (aceptado por diseño)
   * - Attacker intenta acceder a otro tenant: bloqueado por RLS + devuelve 404
   * - Attacker intenta inyección: bloqueado por ParseUUIDPipe (400)
   *
   * Ver: docs/security/public-endpoints.md para threat model completo
   */
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
