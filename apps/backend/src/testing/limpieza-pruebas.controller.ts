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
import {
  LimpiezaMesasService,
  type ResultadoLimpiezaMesas,
  type ResumenMesas,
} from './limpieza-mesas.service';

/** Resumen por área (solo las que se pidieron) y si fue dry-run. */
export interface RespuestaLimpieza {
  dryRun: boolean;
  pedidos?: ResumenPedidos;
  mesas?: ResumenMesas;
}

/**
 * BL-475 (BL-285, ADR 0011): `POST /testing/limpieza`. Deja los datos de
 * prueba del tenant como el seed, por áreas y en orden: pedidos (BL-475) y
 * mesas y plano (BL-479). Lo usan el fixture de los E2E y el script de
 * limpieza de local y staging. Solo ADMIN, en el tenant del token. Fuera
 * del contrato OpenAPI, como `/test` (BL-211).
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
    private readonly limpiezaMesas: LimpiezaMesasService,
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
    const dryRun = dto.dryRun === true;
    const respuesta: RespuestaLimpieza = { dryRun };

    if (areas.includes('pedidos')) {
      const { cerrados, ...resumen } = await this.limpieza.limpiar(
        tenantId,
        sub,
        dto,
      );
      if (cerrados.length > 0) this.avisar(tenantId, cerrados);
      respuesta.pedidos = resumen;
    }
    // Después de pedidos: sin pedidos abiertos, las mesas se pueden cerrar.
    if (areas.includes('mesas')) {
      const { cambios, mesasDelSalon, ...resumen } =
        await this.limpiezaMesas.limpiar(tenantId, sub, dryRun);
      if (!dryRun) this.avisarMesas(tenantId, { cambios, mesasDelSalon });
      respuesta.mesas = resumen;
    }
    return respuesta;
  }

  /**
   * El mapa de mesas ve el estado nuevo y no queda ninguna alerta de las
   * mesas del salón (llamados y avisos de efectivo).
   */
  private avisarMesas(
    tenantId: string,
    mesas: Pick<ResultadoLimpiezaMesas, 'cambios' | 'mesasDelSalon'>,
  ) {
    for (const { mesaId, estado } of mesas.cambios) {
      this.kdsGateway.emitirEstadoMesa(tenantId, mesaId, estado);
    }
    for (const mesaId of mesas.mesasDelSalon) {
      this.kdsGateway.emitirLlamadoResuelto(tenantId, mesaId);
    }
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
