import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthComensalService } from './auth-comensal.service';
import { EmitirTokenComensalDto } from './dto/emitir-token-comensal.dto';
import { EmitirTokenComensalMesaDto } from './dto/emitir-token-comensal-mesa.dto';
import { EmitirTokenComensalLinkDto } from './dto/emitir-token-comensal-link.dto';
import { ApiTags } from '@nestjs/swagger';
import {
  LIMITE_APERTURAS_LINK_POR_MINUTO,
  LinkPagoThrottlerGuard,
} from '../link-pago/link-pago-throttler.guard';

@ApiTags('Autenticación del comensal')
@Controller('auth/comensal')
export class AuthComensalController {
  constructor(private readonly authComensalService: AuthComensalService) {}

  // Pedido para retirar (link web del local): { tenantId, restauranteId }.
  // La mesa ya no se acepta acá (BL-204): las mesas usan POST /mesa con el QR.
  @Post()
  @HttpCode(200)
  emitirToken(@Body() dto: EmitirTokenComensalDto) {
    return this.authComensalService.emitirToken(
      dto.tenantId,
      dto.restauranteId,
    );
  }

  // HU-034 (BL-204): token del comensal en una mesa, a partir del QR. Solo
  // se emite si el QR es válido y está vigente (404 / 410 si no).
  @Post('mesa')
  @HttpCode(200)
  emitirTokenMesa(@Body() dto: EmitirTokenComensalMesaDto) {
    return this.authComensalService.emitirTokenPorQr(
      dto.qrToken,
      dto.sesionMesa,
    );
  }

  // HU-033 (BL-203): token del comensal que abre un link de pago. Solo se
  // emite si el link es el vigente del pedido (404 / 410 si no). Con
  // límite por link (429), porque cada llamado válido va a Keycloak.
  @Post('link-pago')
  @HttpCode(200)
  @UseGuards(LinkPagoThrottlerGuard)
  @Throttle({
    default: { limit: LIMITE_APERTURAS_LINK_POR_MINUTO, ttl: 60_000 },
  })
  emitirTokenLink(@Body() dto: EmitirTokenComensalLinkDto) {
    return this.authComensalService.emitirTokenPorLink(dto.linkToken);
  }
}
