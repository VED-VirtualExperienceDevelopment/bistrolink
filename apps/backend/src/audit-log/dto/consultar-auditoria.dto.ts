import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { AuditAction } from '../audit-action.enum';

/**
 * HU-035 (BL-205): filtros de GET /auditoria. Todos opcionales; sin filtros
 * devuelve lo más reciente del tenant.
 */
export class ConsultarAuditoriaDto {
  /** Desde esta fecha y hora (ISO 8601), inclusive. */
  @IsOptional()
  @IsDateString()
  desde?: string;

  /** Hasta esta fecha y hora (ISO 8601), inclusive. */
  @IsOptional()
  @IsDateString()
  hasta?: string;

  /** Usuario del tenant que hizo la acción (id de `usuario`). */
  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @IsOptional()
  @IsEnum(AuditAction)
  accion?: AuditAction;

  /** Página, desde 1. Cada página trae TAMANO_PAGINA_AUDITORIA registros. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pagina?: number;
}
