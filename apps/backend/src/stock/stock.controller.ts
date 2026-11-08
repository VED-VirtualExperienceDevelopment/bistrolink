import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { SEGURIDAD_KEYCLOAK } from '../openapi';
import { KdsGateway } from '../pedidos/kds.gateway';
import { MenuGateway } from '../menu/menu.gateway';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import { StockService } from './stock.service';

/**
 * HU-015 (BL-120): stock de la jornada y alertas de stock bajo. Solo ADMIN:
 * MOZO y COCINA reciben 403, y sin token, 401 (BL-122: solo el
 * Administrador modifica el stock y los umbrales).
 *
 * El establecimiento sale del token (tenantId), nunca de la ruta ni del
 * body; el actor de la auditoría es el sub del token.
 */
@ApiTags('Stock')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('admin/stock')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly kdsGateway: KdsGateway,
    private readonly menuGateway: MenuGateway,
  ) {}

  /** Los ítems de la carta con su stock, para la carga de la jornada. */
  @Get()
  listar(@Req() req: { user: AuthenticatedUser }) {
    return this.stock.listar(req.user.tenantId);
  }

  /** Los ítems por agotarse o agotados (la campana del header). */
  @Get('alertas')
  alertas(@Req() req: { user: AuthenticatedUser }) {
    return this.stock.alertas(req.user.tenantId);
  }

  /**
   * Carga de la jornada o reposición. Después del commit avisa a la carta
   * del comensal los ítems que cambiaron de disponibilidad y a las campanas
   * de los administradores que el stock cambió.
   */
  @Patch()
  async ajustar(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: AjustarStockDto,
  ) {
    const { tenantId, sub } = req.user;
    const resultado = await this.stock.ajustar(tenantId, dto, { id: sub });
    for (const cambio of resultado.disponibilidadCambiada) {
      this.menuGateway.emitItemUpdated(tenantId, cambio);
    }
    this.kdsGateway.emitirStockActualizado(tenantId);
    return resultado.items;
  }
}
