import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  LARGO_MAXIMO_DESCRIPCION_CATEGORIA,
  LARGO_MAXIMO_NOMBRE_CATEGORIA,
  sinEspaciosExtremos,
} from './create-categoria.dto';

/** BL-395: edición de una categoría; mismas reglas que el alta. */
export class UpdateCategoriaDto {
  @IsOptional()
  @Transform(sinEspaciosExtremos)
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(LARGO_MAXIMO_NOMBRE_CATEGORIA, {
    message: `El nombre no puede superar los ${LARGO_MAXIMO_NOMBRE_CATEGORIA} caracteres`,
  })
  nombre?: string;

  @IsOptional()
  @Transform(sinEspaciosExtremos)
  @IsString()
  @MaxLength(LARGO_MAXIMO_DESCRIPCION_CATEGORIA, {
    message: `La descripción no puede superar los ${LARGO_MAXIMO_DESCRIPCION_CATEGORIA} caracteres`,
  })
  descripcion?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'El orden no puede ser negativo' })
  orden?: number;

  // Visible en la carta del comensal (el switch «Visible»).
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
