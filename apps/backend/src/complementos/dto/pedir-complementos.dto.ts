import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Más platos distintos que esto no tiene sentido en un pedido. */
export const MAXIMO_PLATOS_EN_PEDIDO = 50;

/**
 * HU-046 (BL-552): los platos que el comensal tiene en el pedido, para
 * sugerirle un complemento. Solo ids de la carta: nada del comensal.
 */
export class PedirComplementosDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAXIMO_PLATOS_EN_PEDIDO)
  // 'loose': mismo criterio que CreateItemDto (ids del seed).
  @IsUUID('loose', { each: true })
  itemsEnPedido: string[];
}
