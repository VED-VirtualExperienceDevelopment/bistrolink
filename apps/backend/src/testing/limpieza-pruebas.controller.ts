import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeController } from '@nestjs/swagger';
import { PedidoEstado } from '@prisma/client';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { KdsGateway } from '../pedidos/kds.gateway';
import { AREAS_LIMPIEZA, LimpiarPedidosDto } from './dto/limpiar-pedidos.dto';
import {
  LimpiezaPruebasService,
  type ResultadoLimpieza,
  type ResumenPedidos,
} from './limpieza-pruebas.service';

/** Resumen por área (solo las que se pidieron) y si fue dry-run. */
export interface RespuestaLimpieza {
  dryRun: boolean;
  pedidos?: ResumenPedidos;
}

/**
 * BL-475 (BL-285): `POST /testing/limpieza`. Cierra los pedidos de prueba
 * que quedaron abiertos (fixture de los E2E y workflow de limpieza de
 * staging). Solo ADMIN, en el tenant del token. Fuera del contrato
 * OpenAPI, como `/test` (BL-211).
 *
 * Solo se registra con E2E_CLEANUP_ENABLED=true (TestingModule): en
 * producción la ruta no existe (404).
 */
@ApiExcludeController()
@Controller('testing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class LimpiezaPruebasController {
  constructor(
    private readonly limpieza: LimpiezaPruebasService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  @Post('limpieza')
  @HttpCode(HttpStatus.OK)
  async limpiar(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: LimpiarPedidosDto,
  ): Promise<RespuestaLimpieza> {
    const { tenantId, sub } = req.user;
    const areas = dto.areas ?? AREAS_LIMPIEZA;
    const respuesta: RespuestaLimpieza = { dryRun: dto.dryRun === true };

    if (areas.includes('pedidos')) {
      const { cerrados, ...resumen } = await this.limpieza.limpiar(
        tenantId,
        sub,
        dto,
      );
      if (cerrados.length > 0) this.avisar(tenantId, cerrados);
      respuesta.pedidos = resumen;
    }
    return respuesta;
  }

  /**
   * Después del commit: los KDS y los comensales ven el cambio, las mesas
   * con un pedido sin pagar cancelado pierden su alerta (aviso de efectivo)
   * y la cola se recalcula.
   */
  private avisar(tenantId: string, cerrados: ResultadoLimpieza['cerrados']) {
    for (const p of cerrados) {
      // Misma forma que PedidoActualizado (transiciones del KDS).
      const actualizado = {
        id: p.id,
        estado: p.estado,
        actualizadoEn: p.actualizadoEn,
        mesaNumero: p.mesaNumero,
        lineas: p.lineas,
      };
      this.kdsGateway.emitirPedidoActualizado(tenantId, actualizado);
    }
    const mesasConCancelados = new Set(
      cerrados
        .filter((p) => p.estado === PedidoEstado.CANCELADO)
        .map((p) => p.mesaId),
    );
    for (const mesaId of mesasConCancelados) {
      this.kdsGateway.emitirLlamadoResuelto(tenantId, mesaId);
    }
    void this.kdsGateway.avisarEstadoCola(tenantId);
  }
}
