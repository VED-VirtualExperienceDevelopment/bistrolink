import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** BL-395: los textos llegan sin espacios al principio ni al final. */
export const sinEspaciosExtremos = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const LARGO_MAXIMO_NOMBRE_CATEGORIA = 60;
export const LARGO_MAXIMO_DESCRIPCION_CATEGORIA = 200;

/**
 * BL-395: alta de una categoría de la carta (hallazgo C6 de la propuesta).
 * Las propiedades de más se rechazan con el ValidationPipe global
 * (forbidNonWhitelisted).
 */
export class CreateCategoriaDto {
  @Transform(sinEspaciosExtremos)
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(LARGO_MAXIMO_NOMBRE_CATEGORIA, {
    message: `El nombre no puede superar los ${LARGO_MAXIMO_NOMBRE_CATEGORIA} caracteres`,
  })
  nombre: string;

  // BL-393: subtítulo opcional («Para compartir», «Al mediodía»).
  @IsOptional()
  @Transform(sinEspaciosExtremos)
  @IsString()
  @MaxLength(LARGO_MAXIMO_DESCRIPCION_CATEGORIA, {
    message: `La descripción no puede superar los ${LARGO_MAXIMO_DESCRIPCION_CATEGORIA} caracteres`,
  })
  descripcion?: string;

  // El formulario actual todavía lo manda. Sale cuando la vista ordene con
  // Subir / Bajar (BL-398 y BL-399).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'El orden no puede ser negativo' })
  orden?: number;
}
