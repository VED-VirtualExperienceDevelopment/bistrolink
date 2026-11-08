import { OmitType } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CrearPedidoDto } from './crear-pedido.dto';

/**
 * HU-039 (BL-209): pedido que carga el mozo. Mismos ítems, observaciones y
 * clave de idempotencia que el del comensal; la mesa va explícita (el mozo
 * no tiene QR) y el restaurante sale de la mesa.
 *
 * mesaId con @IsUUID('loose'), igual que los demás DTOs que reciben ids del
 * seed: la mesa del seed (3333…) no es UUID v4 y con '4' el pedido del mozo
 * respondía 400 (ver ids-seed-uuid.dto.spec.ts).
 */
export class CrearPedidoMozoDto extends OmitType(CrearPedidoDto, [
  'restauranteId',
] as const) {
  @IsUUID('loose', { message: 'mesaId debe tener formato UUID' })
  mesaId: string;
}
