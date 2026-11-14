import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** HU-033 (BL-203): POST /cobros/pendientes/:pedidoId/link-pago. */
export class GenerarLinkPagoDto {
  @ApiPropertyOptional({
    description:
      'Reemplazar el link vigente del pedido. Sin esto, si ya hay uno, responde 409 (LINK_PAGO_ACTIVO).',
  })
  @IsOptional()
  @IsBoolean()
  reemplazar?: boolean;
}
