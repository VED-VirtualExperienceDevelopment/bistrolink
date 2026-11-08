import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { limpiarEspacios } from '../../usuarios/dto/create-usuario.dto';

/** BL-413: largo del motivo. El máximo es el de tenant.motivo_suspension. */
export const LARGO_MINIMO_MOTIVO = 3;
export const LARGO_MAXIMO_MOTIVO = 200;

/**
 * BL-413: POST /plataforma/establecimientos/:tenantId/suspender. El motivo
 * es obligatorio: queda en la ficha y en la auditoría, para saber por qué
 * se suspendió cuando haya que reactivarlo. Se guardan los espacios
 * limpios, como el resto de los textos.
 */
export class SuspenderEstablecimientoDto {
  @Transform(limpiarEspacios)
  @IsString({ message: 'El motivo es obligatorio' })
  @MinLength(LARGO_MINIMO_MOTIVO, {
    message: `El motivo tiene que tener al menos ${LARGO_MINIMO_MOTIVO} caracteres`,
  })
  @MaxLength(LARGO_MAXIMO_MOTIVO, {
    message: `El motivo admite como mucho ${LARGO_MAXIMO_MOTIVO} caracteres`,
  })
  motivo!: string;
}
