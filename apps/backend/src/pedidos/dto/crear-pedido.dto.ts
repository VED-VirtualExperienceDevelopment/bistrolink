import { Type, Transform } from 'class-transformer';
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

function stripHtmlTagsSafely(input: string): string {
  let previous: string;
  let current = input;

  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);

  return current.trim();
}

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
  // ✅ Sanitización robusta: elimina etiquetas en iteraciones hasta estabilizar
  @Transform(({ value }) =>
    typeof value === 'string' ? stripHtmlTagsSafely(value) : value,
  )
  observacion?: string;
}

export class CrearPedidoDto {
  /**
   * BL-309 / BL-204: obligatorio solo en el pedido para retirar. En el
   * pedido de mesa el restaurante sale de la mesa del QR, del lado del
   * servidor; si igual se manda, tiene que coincidir o se rechaza con 403.
   *
   * Acá es opcional porque el DTO no ve los headers: con X-Mesa-Token el
   * body no trae ningún id, y eso es válido. El "falta restauranteId en un
   * pedido para retirar" (400) lo decide PedidosService.crear, que sí sabe
   * si vino el QR.
   *
   * HU-034 (BL-204): no hay campo mesaId. La mesa sale solo del QR; si un
   * cliente lo manda igual, el ValidationPipe (forbidNonWhitelisted) lo
   * rechaza con 400.
   */
  @IsOptional()
  @Matches(UUID_REGEX, { message: 'restauranteId debe tener formato UUID' })
  restauranteId?: string;

  @IsString()
  @Length(1, 64)
  idempotencyKey: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CrearPedidoItemDto) // ← CRUCIAL: Hace que @Transform funcione dentro del array
  items: CrearPedidoItemDto[];

  @IsOptional()
  @IsString({ message: 'La observación general debe ser texto' })
  @MaxLength(500, {
    message: 'La nota general del pedido no puede exceder 500 caracteres',
  })
  // ✅ Sanitización robusta: elimina etiquetas en iteraciones hasta estabilizar
  @Transform(({ value }) =>
    typeof value === 'string' ? stripHtmlTagsSafely(value) : value,
  )
  observacionGeneral?: string;
}
