import { OmitType } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CrearPedidoDto } from './crear-pedido.dto';

/**
 * HU-039 (BL-209): pedido que carga el mozo. Mismos ítems, observaciones y
 * clave de idempotencia que el del comensal; la mesa va explícita (el mozo
 * no tiene QR) y el restaurante sale de la mesa.
 */
export class CrearPedidoMozoDto extends OmitType(CrearPedidoDto, [
  'restauranteId',
] as const) {
  @IsUUID('4', { message: 'mesaId debe tener formato UUID' })
  mesaId: string;
}
