import { IsBoolean } from 'class-validator';

/**
 * BL-395: marcar un ítem como agotado o disponible. Es lo único de la carta
 * que puede cambiar el MOZO.
 */
export class CambiarDisponibilidadDto {
  @IsBoolean({ message: 'disponible tiene que ser true o false' })
  disponible: boolean;
}
