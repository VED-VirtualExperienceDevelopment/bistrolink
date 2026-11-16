import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { LARGO_MAXIMO_COMENTARIO, limpiarComentario } from '../valoracion';

/** HU-050 (BL-558): valoración del comensal, de 1 a 5 y un comentario opcional. */
export class ValorarPedidoDto {
  @IsInt({ message: 'estrellas debe ser un número entero' })
  @Min(1, { message: 'estrellas debe ser de 1 a 5' })
  @Max(5, { message: 'estrellas debe ser de 1 a 5' })
  estrellas: number;

  // Se limpia antes de validar (sin etiquetas, sin espacios de más; vacío =
  // sin comentario). Uno más largo que el máximo no se limpia: lo rechaza
  // @MaxLength.
  @IsOptional()
  @IsString({ message: 'El comentario debe ser texto' })
  @MaxLength(LARGO_MAXIMO_COMENTARIO, {
    message: `El comentario puede tener hasta ${LARGO_MAXIMO_COMENTARIO} caracteres`,
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.length <= LARGO_MAXIMO_COMENTARIO
      ? (limpiarComentario(value) ?? undefined)
      : value,
  )
  comentario?: string;
}
