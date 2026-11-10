import { IsString, Length } from 'class-validator';

/**
 * HU-040 (BL-210): POST /pedidos/:pedidoId/entregar-retiro. El código que
 * dice el comensal al retirar («R-042», «r42» o «42»); el servicio lo
 * normaliza y lo compara con el del pedido.
 */
export class EntregarRetiroDto {
  @IsString({ message: 'El código de retiro debe ser texto' })
  @Length(1, 10, {
    message: 'El código de retiro debe tener entre 1 y 10 caracteres',
  })
  codigo: string;
}
