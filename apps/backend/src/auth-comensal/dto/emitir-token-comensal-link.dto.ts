import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * HU-033 (BL-203): emisión del token del comensal desde un link de pago. El
 * único dato es el token del link (/pagar/<token>): el tenant, el
 * restaurante y el pedido salen de ahí, nunca del cliente.
 */
export class EmitirTokenComensalLinkDto {
  @IsString()
  @MaxLength(128, { message: 'linkToken inválido' })
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'linkToken inválido' })
  linkToken: string;
}
