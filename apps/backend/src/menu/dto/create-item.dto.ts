import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateItemDto {
  @IsUUID()
  categoriaId: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  nombre: string;

  @IsString()
  @Matches(/^(0|[1-9]\d*)(\.\d{1,2})?$/, {
    message:
      'El precio debe ser un número positivo válido con hasta 2 decimales',
  })
  precio: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @IsOptional()
  @IsString()
  imagenKey?: string;
}
