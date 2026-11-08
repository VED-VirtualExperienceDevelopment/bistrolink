import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** HU-011 (BL-488): estados que se pueden filtrar en el panel. */
export const ESTADOS_SINCRONIZACION_POS = [
  'PENDIENTE',
  'ENVIADA',
  'ERROR',
  'DESCARTADA',
] as const;
export type EstadoSincronizacionPos =
  (typeof ESTADOS_SINCRONIZACION_POS)[number];

/** GET /admin/pos/sincronizaciones. */
export class ConsultarSincronizacionesPosDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pagina debe ser un número entero' })
  @Min(1, { message: 'pagina debe ser 1 o más' })
  @Max(1000, { message: 'pagina debe ser 1000 o menos' })
  pagina?: number;

  @IsOptional()
  @IsIn(ESTADOS_SINCRONIZACION_POS, {
    message: `estado debe ser uno de: ${ESTADOS_SINCRONIZACION_POS.join(', ')}`,
  })
  estado?: EstadoSincronizacionPos;
}

/** PATCH /admin/pos/configuracion. */
export class CambiarSincronizacionPosDto {
  @IsBoolean({ message: 'habilitada debe ser verdadero o falso' })
  habilitada!: boolean;
}
