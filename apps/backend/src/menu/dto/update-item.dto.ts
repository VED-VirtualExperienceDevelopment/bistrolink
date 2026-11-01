import {
  IsISO8601,
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  Matches,
  IsNotEmpty,
} from 'class-validator';

export class UpdateItemDto {
  @IsOptional()
  // 'loose': mismo criterio que CreateItemDto.
  @IsUUID('loose')
  categoriaId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  nombre?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(0|[1-9]\d*)(\.\d{1,2})?$/, {
    message:
      'El precio debe ser un número positivo válido con hasta 2 decimales',
  })
  precio?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @IsOptional()
  @IsString()
  imagenKey?: string;

  // BL-394: bloqueo optimista. Versión (updatedAt) que cargó el formulario;
  // si otra persona guardó después, la API responde 409.
  @IsOptional()
  @IsISO8601({}, { message: 'updatedAt tiene que ser una fecha ISO 8601' })
  updatedAt?: string;
}
