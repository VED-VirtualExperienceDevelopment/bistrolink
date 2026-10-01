import { IsString, IsOptional, IsBoolean, IsUUID, IsDecimal } from 'class-validator';

export class UpdateItemDto {
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsDecimal({ decimal_digits: '2' }, { message: 'El precio debe tener hasta 2 decimales' })
  precio?: string;

  @IsOptional()
  @IsBoolean()
  disponible?: boolean;

  @IsOptional()
  @IsString()
  imagenKey?: string;
}
