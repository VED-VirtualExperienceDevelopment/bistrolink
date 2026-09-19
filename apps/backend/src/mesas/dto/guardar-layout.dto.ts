import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { MesaLayoutDto } from './mesa-layout.dto';

/**
 * Una mesa dentro del guardado masivo del mapa (POST /mesas/layout).
 *
 * - `id` presente → actualiza el layout de una mesa existente (debe
 *   pertenecer al mismo tenant + restaurante, se valida en el service).
 * - `id` ausente → crea una mesa nueva con ese `numero` y ese layout. Nace
 *   en estado LIBRE (mismo default que el alta manual de mesas).
 */
export class MesaLayoutItemDto extends MesaLayoutDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsInt()
  @Min(1, {
    message:
      'numero debe ser mayor a 0 (el 0 está reservado a la mesa virtual de HU-003)',
  })
  numero: number;
}

export class GuardarLayoutDto {
  @IsUUID()
  restauranteId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MesaLayoutItemDto)
  mesas: MesaLayoutItemDto[];
}
