import {
  IsISO8601,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
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

  // BL-399: sin «orden»; se cambia con PUT /admin/menu/categorias/orden.

  // Visible en la carta del comensal (el switch «Visible»).
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  // BL-394: bloqueo optimista. Versión (updatedAt) que cargó el formulario;
  // si otra persona guardó después, la API responde 409.
  @IsOptional()
  @IsISO8601({}, { message: 'updatedAt tiene que ser una fecha ISO 8601' })
  updatedAt?: string;
}
