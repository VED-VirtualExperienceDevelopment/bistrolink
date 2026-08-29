import { IsOptional, Matches } from 'class-validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EmitirTokenComensalDto {
  @Matches(UUID_REGEX, { message: 'tenantId debe tener formato UUID' })
  tenantId: string;

  @IsOptional()
  @Matches(UUID_REGEX, { message: 'mesaId debe tener formato UUID' })
  mesaId?: string;

  @IsOptional()
  @Matches(UUID_REGEX, { message: 'restauranteId debe tener formato UUID' })
  restauranteId?: string;
}
