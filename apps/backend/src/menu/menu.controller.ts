import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { MenuService } from './menu.service';
import { QrMesaAccesoService } from '../qr-mesa/qr-mesa-acceso.service';
import {
  MENSAJE_SUSPENDIDO_COMENSAL,
  TenantEstadoService,
} from '../tenant-estado/tenant-estado.service';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly qrMesaAcceso: QrMesaAccesoService,
    private readonly tenantEstado: TenantEstadoService,
  ) {}

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
   *
   * BL-413: establecimiento suspendido → 403 con el código
   * ESTABLECIMIENTO_SUSPENDIDO; la página muestra «no disponible».
   */
  @Get('tenant/:tenantId/restaurante/:restauranteId')
  async getMenuPublico(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('restauranteId', ParseUUIDPipe) restauranteId: string,
  ) {
    await this.tenantEstado.asegurarActivo(
      tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    return this.menuService.getMenuByRestaurante(tenantId, restauranteId);
  }

  /**
   * HU-034 (BL-204): menú de una mesa a partir del token opaco del QR
   * (/q/<token>). Público, como el resto del menú (HU-001: sin login).
   *
   * - Token inválido, de otra clave, de una mesa inexistente o virtual: 404
   *   genérico, sin distinguir el motivo.
   * - Token de una versión anterior (el QR se regeneró): 410 Gone.
   *
   * La respuesta no incluye ids internos: solo el número de mesa.
   *
   * Reemplaza a GET /menu/:tenantId/:mesaId (acceso por ids), que se retiró
   * en BL-204: con los ids en la URL, cualquiera podía armar el enlace de
   * otra mesa.
   *
   * BL-413: con un QR válido de un establecimiento suspendido, 403 (después
   * de validar el QR: un QR inválido sigue siendo 404).
   */
  @Get('qr/:token')
  async getMenuPorQr(@Param('token') token: string) {
    const mesa = await this.qrMesaAcceso.resolver(token);
    await this.tenantEstado.asegurarActivo(
      mesa.tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    const menu = await this.menuService.getMenuByMesa(
      mesa.tenantId,
      mesa.mesaId,
    );
    return { ...menu, mesa: { numero: mesa.numero } };
  }
}
