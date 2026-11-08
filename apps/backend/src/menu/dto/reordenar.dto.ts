import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/** Más que cualquier carta real; corta pedidos absurdos. */
export const MAXIMO_A_REORDENAR = 500;

/**
 * BL-399: orden nuevo de las categorías de un restaurante o de los ítems de
 * una categoría. Es la lista completa de ids, en el orden en que tienen que
 * quedar; la API la guarda de una vez como 1, 2, 3… (propuesta v0.9, §5.4).
 */
export class ReordenarDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'La lista no puede estar vacía' })
  @ArrayMaxSize(MAXIMO_A_REORDENAR)
  @ArrayUnique({ message: 'La lista no puede repetir ids' })
  // 'loose': acepta los ids del seed, igual que CreateItemDto.
  @IsUUID('loose', { each: true, message: 'Cada id tiene que ser un UUID' })
  ids: string[];
}
