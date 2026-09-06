import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CrearPedidoItemDto {
  @Matches(UUID_REGEX, { message: 'itemCartaId debe tener formato UUID' })
  itemCartaId: string;

  @IsInt()
  @Min(1)
  cantidad: number;

  @IsOptional()
  @IsString({ message: 'La observación del ítem debe ser texto' })
  @MaxLength(300, {
    message: 'La nota del ítem no puede exceder 300 caracteres',
  })
  observacion?: string;
}

export class CrearPedidoDto {
  @Matches(UUID_REGEX, { message: 'restauranteId debe tener formato UUID' })
  restauranteId: string;

  @IsOptional()
  @Matches(UUID_REGEX, { message: 'mesaId debe tener formato UUID' })
  mesaId?: string;

  @IsString()
  @Length(1, 64)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CrearPedidoItemDto)
  items: CrearPedidoItemDto[];

  @IsOptional()
  @IsString({ message: 'La observación general debe ser texto' })
  @MaxLength(500, {
    message: 'La nota general del pedido no puede exceder 500 caracteres',
  })
  observacionGeneral?: string;
}
