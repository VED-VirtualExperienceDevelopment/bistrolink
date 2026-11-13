import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** BL-502: cuántos pedidos puede consultar un comensal de una vez. */
export const MAXIMO_PEDIDOS_POR_CONSULTA = 30;

/**
 * BL-502: los pedidos que el comensal hizo desde este dispositivo en la
 * mesa (los recuerda el navegador). El backend devuelve solo los que son de
 * esa mesa y de la sesión abierta.
 */
export class EstadoPedidosMesaDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    maxItems: MAXIMO_PEDIDOS_POR_CONSULTA,
  })
  @IsArray({ message: 'ids tiene que ser una lista' })
  @ArrayMaxSize(MAXIMO_PEDIDOS_POR_CONSULTA, {
    message: `Se pueden consultar hasta ${MAXIMO_PEDIDOS_POR_CONSULTA} pedidos`,
  })
  @ArrayUnique({ message: 'ids tiene pedidos repetidos' })
  @IsUUID('all', { each: true, message: 'Cada id tiene que ser un UUID' })
  ids: string[];
}
