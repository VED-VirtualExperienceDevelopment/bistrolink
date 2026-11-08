import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** HU-015 (BL-120): cuántos ítems se pueden ajustar en un solo pedido. */
export const MAXIMO_AJUSTES_STOCK = 500;
/** Tope razonable de unidades por ítem: evita un número tipeado de más. */
export const MAXIMO_UNIDADES_STOCK = 100_000;

/** El ajuste de un ítem: lo que no viene, no cambia. */
export class AjusteStockItemDto {
  // 'loose', igual que los demás DTOs que reciben ids del seed: los ítems del
  // seed (5555…, 6666…) no son UUID v4 y con '4' guardar el stock respondía
  // 400 "items.0.itemId debe ser un UUID" (ver ids-seed-uuid.dto.spec.ts).
  @IsUUID('loose', { message: 'itemId debe ser un UUID' })
  itemId!: string;

  @IsOptional()
  @IsBoolean({ message: 'controlaStock debe ser verdadero o falso' })
  controlaStock?: boolean;

  @IsOptional()
  @IsInt({ message: 'stockActual debe ser un número entero' })
  @Min(0, { message: 'stockActual no puede ser negativo' })
  @Max(MAXIMO_UNIDADES_STOCK, {
    message: `stockActual no puede ser mayor que ${MAXIMO_UNIDADES_STOCK}`,
  })
  stockActual?: number;

  @IsOptional()
  @IsInt({ message: 'umbralAlerta debe ser un número entero' })
  @Min(0, { message: 'umbralAlerta no puede ser negativo' })
  @Max(MAXIMO_UNIDADES_STOCK, {
    message: `umbralAlerta no puede ser mayor que ${MAXIMO_UNIDADES_STOCK}`,
  })
  umbralAlerta?: number;
}

/**
 * HU-015 (BL-120): PATCH /admin/stock. Sirve para la carga de la jornada
 * (muchos ítems) y para reponer uno desde la campana.
 */
export class AjustarStockDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Indicá al menos un ítem' })
  @ArrayMaxSize(MAXIMO_AJUSTES_STOCK, {
    message: `Se pueden ajustar hasta ${MAXIMO_AJUSTES_STOCK} ítems a la vez`,
  })
  @ValidateNested({ each: true })
  @Type(() => AjusteStockItemDto)
  items!: AjusteStockItemDto[];
}
