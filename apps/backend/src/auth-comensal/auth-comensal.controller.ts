import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthComensalService } from './auth-comensal.service';
import { EmitirTokenComensalDto } from './dto/emitir-token-comensal.dto';
import { EmitirTokenComensalMesaDto } from './dto/emitir-token-comensal-mesa.dto';

@Controller('auth/comensal')
export class AuthComensalController {
  constructor(private readonly authComensalService: AuthComensalService) {}

  // Pedido para retirar (link web del local): { tenantId, restauranteId }.
  // PROVISORIO (BL-204): también acepta { tenantId, mesaId }; ese camino se
  // retira en el paso 6 de BL-204 y las mesas pasan a usar POST /mesa.
  @Post()
  @HttpCode(200)
  emitirToken(@Body() dto: EmitirTokenComensalDto) {
    return this.authComensalService.emitirToken(
      dto.tenantId,
      dto.mesaId,
      dto.restauranteId,
    );
  }

  // HU-034 (BL-204): token del comensal en una mesa, a partir del QR. Solo
  // se emite si el QR es válido y está vigente (404 / 410 si no).
  @Post('mesa')
  @HttpCode(200)
  emitirTokenMesa(@Body() dto: EmitirTokenComensalMesaDto) {
    return this.authComensalService.emitirTokenPorQr(dto.qrToken);
  }
}
