import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaDelQr } from '../qr-mesa/qr-mesa-acceso.service';
import {
  MesaDelQrActual,
  MesaQrGuard,
  MesaQrObligatoriaGuard,
} from '../qr-mesa/mesa-qr.guard';
import { PedidosService } from './pedidos.service';
import { CrearPedidoDto } from './dto/crear-pedido.dto';
import { CrearPedidoMozoDto } from './dto/crear-pedido-mozo.dto';
import { EstadoPedidosMesaDto } from './dto/estado-pedidos-mesa.dto';
import { PedidosDeLaMesaService } from './pedidos-de-la-mesa.service';
import { EntregarRetiroDto } from './dto/entregar-retiro.dto';
import { PedidosTransicionService } from './pedidos-transicion.service';
import { KdsGateway } from './kds.gateway';
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { SEGURIDAD_KEYCLOAK, SEGURIDAD_MESA_QR } from '../openapi';

@ApiTags('Pedidos')
// Pedido para retirar: solo el token del comensal. Pedido de mesa: además,
// el QR de la mesa (BL-204).
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@ApiSecurity({ [SEGURIDAD_KEYCLOAK]: [], [SEGURIDAD_MESA_QR]: [] })
@Controller('pedidos')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class PedidosController {
  constructor(
    private readonly pedidosService: PedidosService,
    private readonly pedidosDeLaMesa: PedidosDeLaMesaService,
    private readonly transicion: PedidosTransicionService,
    private readonly kdsGateway: KdsGateway,
  ) {}

  // HU-034 (BL-204): con X-Mesa-Token, el pedido queda atado a la mesa del
  // QR (MesaQrGuard); sin él, es un pedido para retirar (canal WEB).
  @Post()
  @UseGuards(MesaQrGuard)
  crear(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CrearPedidoDto,
    @MesaDelQrActual() mesaQr?: MesaDelQr,
  ) {
    return this.pedidosService.crear(req.user.tenantId, dto, mesaQr);
  }

  // BL-502: «Mis pedidos» del comensal en la mesa. Solo desde la mesa (QR y
  // sesión abierta, 410 si se cerró) y solo los pedidos de esa mesa y de esa
  // sesión, de los ids que recuerda el navegador. POST para no poner la
  // lista de ids en la URL (ni en los logs de acceso).
  @Post('mesa/estado')
  @HttpCode(200)
  @UseGuards(MesaQrGuard, MesaQrObligatoriaGuard)
  estadoEnLaMesa(
    @Body() dto: EstadoPedidosMesaDto,
    @MesaDelQrActual() mesaQr: MesaDelQr,
  ) {
    return this.pedidosDeLaMesa.estado(mesaQr, dto.ids);
  }

  // HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular, en
  // una mesa abierta. Solo MOZO y ADMIN (pisa el COMENSAL de la clase):
  // Cocina y Comensal reciben 403. El actor sale del token, nunca del body.
  @Post('mozo')
  @Roles('ADMIN', 'MOZO')
  crearPorMozo(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CrearPedidoMozoDto,
  ) {
    return this.pedidosService.crearPorMozo(
      req.user.tenantId,
      req.user.sub,
      dto,
    );
  }

  /**
   * HU-040 (BL-210): el comensal pasa a retirar y el mozo o el
   * administrador escribe el código que muestra. Si coincide y el pedido
   * está listo, queda ENTREGADO y se avisa al KDS y al comensal. 409 si no
   * coincide, si todavía no está listo o si no es para retirar.
   */
  @Post(':pedidoId/entregar-retiro')
  @Roles('ADMIN', 'MOZO')
  @HttpCode(HttpStatus.OK)
  async entregarRetiro(
    @Req() req: { user: AuthenticatedUser },
    @Param('pedidoId', new ParseUUIDPipe()) pedidoId: string,
    @Body() dto: EntregarRetiroDto,
  ) {
    const entregado = await this.transicion.entregarRetiro({
      tenantId: req.user.tenantId,
      keycloakId: req.user.sub,
      pedidoId,
      codigo: dto.codigo,
    });
    this.kdsGateway.emitirPedidoActualizado(req.user.tenantId, entregado);
    return entregado;
  }
}
