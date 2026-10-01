import { IsIn, IsObject, IsString, Length, Matches } from 'class-validator';
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// BL-90: el monto NUNCA viaja en este DTO. Se calcula siempre en el
// backend a partir de las líneas del pedido, para que el cliente no pueda
// manipularlo enviando un monto distinto al real.
export class CrearPagoDto {
  @Matches(UUID_REGEX, { message: 'pedidoId debe tener formato UUID' })
  pedidoId: string;

  @IsString()
  @Length(1, 64)
  idempotencyKey: string;

  @IsIn(['PLEXO', 'MERCADOPAGO'], {
    message: 'medioPago debe ser PLEXO o MERCADOPAGO',
  })
  medioPago: string;

  @IsObject()
  datosPasarela: Record<string, unknown>;
}
