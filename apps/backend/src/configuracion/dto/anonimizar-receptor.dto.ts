import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { normalizarRut } from '../../cfe/receptor-fiscal';
import { EsRutUruguayo } from '../../plataforma/rut';

/**
 * HU-009 (BL-453): RUT del comensal que pidió anonimizar sus datos de
 * facturación. Se acepta con puntos, guiones o espacios.
 */
export class AnonimizarReceptorDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarRut(value) : value,
  )
  @IsString()
  @EsRutUruguayo()
  rut: string;
}
