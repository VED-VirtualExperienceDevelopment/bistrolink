import { Transform } from 'class-transformer';
import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';
import { TotalEsperado } from '../total-esperado.decorator';

/** HU-007b (BL-80): tipo de tarjeta que cobró el POS del local. */
export const TARJETAS_POS = ['CREDITO', 'DEBITO'] as const;
export type TarjetaPos = (typeof TARJETAS_POS)[number];

/** Sin espacios ni guiones y en mayúsculas, como figura en el voucher. */
const normalizarAutorizacion = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : value;

/**
 * HU-007b (BL-80): cobro hecho con el POS del local que registra el mozo o
 * el administrador.
 *
 * Igual que en efectivo, el total NO viaja en el body: se calcula en el
 * backend con las líneas del pedido y la propina elegida (HU-022). Nunca
 * viajan datos de la tarjeta (PAN, vencimiento ni CVV): solo el tipo y el
 * número de autorización del voucher.
 */
export class RegistrarCobroPosDto {
  @IsUUID('4', { message: 'pedidoId debe tener formato UUID' })
  pedidoId: string;

  /** Una por cobro: un doble clic o un reintento no registra dos (RNF.03). */
  @IsString()
  @Length(1, 64)
  idempotencyKey: string;

  @IsIn(TARJETAS_POS, { message: 'tarjeta debe ser CREDITO o DEBITO' })
  tarjeta: TarjetaPos;

  /**
   * Número de autorización del voucher: de 4 a 12 letras o números. Con 13
   * o más dígitos podría ser un número de tarjeta, que no se acepta.
   */
  @Transform(normalizarAutorizacion)
  @Matches(/^[A-Z0-9]{4,12}$/, {
    message:
      'El número de autorización debe tener entre 4 y 12 letras o números (está en el voucher del POS)',
  })
  autorizacion: string;

  /** HU-022 (BL-494): el total que vio el personal; ver TotalEsperado. */
  @TotalEsperado()
  totalEsperado?: string;
}
