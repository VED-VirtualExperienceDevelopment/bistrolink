import { Matches } from 'class-validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Token del comensal para el pedido para retirar (link web del local,
 * HU-002). La mesa ya no se acepta acá (HU-034, BL-204): el token de la mesa
 * sale solo del QR (POST /auth/comensal/mesa).
 */
export class EmitirTokenComensalDto {
  @Matches(UUID_REGEX, { message: 'tenantId debe tener formato UUID' })
  tenantId: string;

  @Matches(UUID_REGEX, { message: 'restauranteId debe tener formato UUID' })
  restauranteId: string;
}
