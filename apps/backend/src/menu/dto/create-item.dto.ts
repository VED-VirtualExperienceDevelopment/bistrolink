import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateItemDto {
  // 'loose': acepta cualquier id 8-4-4-4-12 hex, igual que la columna uuid
  // de Postgres y ParseUUIDPipe. El modo por defecto exige RFC 4122 y rechaza
  // los ids del seed (4444… de las categorías de A; ver TC-I-032).
  @IsUUID('loose')
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
