import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * HU-034 (BL-204): emisión del token del comensal desde una mesa. El único
 * dato es el token del QR (/q/<token>): la mesa y el tenant salen de ahí,
 * nunca del cliente.
 */
export class EmitirTokenComensalMesaDto {
  @IsString()
  @MaxLength(128, { message: 'qrToken inválido' })
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'qrToken inválido' })
  qrToken: string;

  /** HU-017 (BL-60): la sesión de la mesa que vino con el menú. */
  @IsUUID('4', { message: 'sesionMesa inválida' })
  sesionMesa: string;
}
