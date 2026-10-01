import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCategoriaDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'El orden no puede ser negativo' })
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
