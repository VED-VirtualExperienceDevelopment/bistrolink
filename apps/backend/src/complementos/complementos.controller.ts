import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import {
  exigirSesionAbierta,
  QrMesaAccesoService,
} from '../qr-mesa/qr-mesa-acceso.service';
import {
  MENSAJE_SUSPENDIDO_COMENSAL,
  TenantEstadoService,
} from '../tenant-estado/tenant-estado.service';
import { ComplementosService } from './complementos.service';
import {
  ComplementosThrottlerGuard,
  LIMITE_COMPLEMENTOS_POR_LOCAL,
  LIMITE_COMPLEMENTOS_POR_QR,
} from './complementos-throttler.guard';
import { PedirComplementosDto } from './dto/pedir-complementos.dto';

/**
 * HU-046 (BL-552): complementos para el pedido del comensal, antes de
 * pagar. Público, como el menú (HU-001: sin login), con las mismas defensas:
 *
 * - Por QR: el token opaco de la mesa (404 si no es válido, 410 si se
 *   regeneró o la mesa está cerrada), igual que GET /menu/qr/:token.
 * - Por enlace web: ParseUUIDPipe en los ids y 404 genérico si el
 *   restaurante no es del tenant.
 * - Establecimiento suspendido: 403, como el menú.
 * - RLS y tenant_id explícito en el servicio; límite de pedidos por minuto.
 *
 * Es POST porque recibe la lista de platos del pedido, pero no cambia nada:
 * responde 200.
 */
@ApiTags('Menú público')
@Controller('menu')
@UseGuards(ComplementosThrottlerGuard)
export class ComplementosController {
  constructor(
    private readonly complementos: ComplementosService,
    private readonly qrMesaAcceso: QrMesaAccesoService,
    private readonly tenantEstado: TenantEstadoService,
  ) {}

  @Post('qr/:token/complementos')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: LIMITE_COMPLEMENTOS_POR_QR, ttl: 60_000 } })
  async porQr(
    @Param('token') token: string,
    @Body() dto: PedirComplementosDto,
  ) {
    const mesa = await this.qrMesaAcceso.resolver(token);
    await this.tenantEstado.asegurarActivo(
      mesa.tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    if (!mesa.sesionId) {
      exigirSesionAbierta(mesa);
    }
    return this.complementos.sugerir(
      mesa.tenantId,
      mesa.restauranteId,
      dto.itemsEnPedido,
    );
  }

  @Post('tenant/:tenantId/restaurante/:restauranteId/complementos')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: LIMITE_COMPLEMENTOS_POR_LOCAL, ttl: 60_000 } })
  async porEnlace(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('restauranteId', ParseUUIDPipe) restauranteId: string,
    @Body() dto: PedirComplementosDto,
  ) {
    await this.tenantEstado.asegurarActivo(
      tenantId,
      MENSAJE_SUSPENDIDO_COMENSAL,
    );
    return this.complementos.sugerir(
      tenantId,
      restauranteId,
      dto.itemsEnPedido,
    );
  }
}
