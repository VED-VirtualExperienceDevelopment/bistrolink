import { CfeEstadoDgi } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_FECHA = 'debe ser una fecha AAAA-MM-DD';

/**
 * HU-009 (BL-455): filtros de GET /admin/comprobantes. Fechas de emisión en
 * hora de Uruguay; sin fechas, los de hoy.
 */
export class ConsultarComprobantesDto {
  @IsOptional()
  @Matches(FECHA, { message: `desde ${MENSAJE_FECHA}` })
  desde?: string;

  @IsOptional()
  @Matches(FECHA, { message: `hasta ${MENSAJE_FECHA}` })
  hasta?: string;

  @IsOptional()
  @IsEnum(CfeEstadoDgi)
  estado?: CfeEstadoDgi;

  /** Página, desde 1. Cada página trae TAMANO_PAGINA_COMPROBANTES. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pagina?: number;
}
