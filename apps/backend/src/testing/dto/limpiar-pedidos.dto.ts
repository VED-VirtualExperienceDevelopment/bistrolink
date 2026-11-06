import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * BL-285: áreas que limpia `POST /testing/limpieza`, en el orden en que se
 * limpian. Cada sub-issue agrega la suya (mesas, carta, configuración,
 * usuarios).
 */
export const AREAS_LIMPIEZA = [
  'pedidos',
  'mesas',
  'carta',
  'configuracion',
  'usuarios',
] as const;
export type AreaLimpieza = (typeof AREAS_LIMPIEZA)[number];

/** BL-475: cuántos pedidos puede cerrar por id un solo pedido de limpieza. */
export const MAXIMO_PEDIDOS_LIMPIEZA = 200;
/** Antigüedad por defecto (horas) cuando no se pasan ids. */
export const ANTIGUEDAD_POR_DEFECTO_HORAS = 24;
/** Tope de antigüedad: 30 días. */
export const ANTIGUEDAD_MAXIMA_HORAS = 720;

/**
 * BL-475 (BL-285): pedido de limpieza de los datos de prueba.
 *
 * - `areas`: qué limpiar (por defecto, todas las de AREAS_LIMPIEZA).
 * - Con `pedidoIds`: cierra solo esos (el fixture de cada E2E).
 * - Sin `pedidoIds`: cierra los abiertos con más de `antiguedadHoras`
 *   (por defecto 24; 0 = todos). Lo usa el workflow de limpieza de staging.
 * - `dryRun`: responde lo que cerraría, sin cambiar nada.
 */
export class LimpiarPedidosDto {
  @IsOptional()
  @IsArray({ message: 'areas debe ser una lista' })
  @IsIn(AREAS_LIMPIEZA, {
    each: true,
    message: `cada área debe ser una de: ${AREAS_LIMPIEZA.join(', ')}`,
  })
  areas?: AreaLimpieza[];

  @IsOptional()
  @IsArray({ message: 'pedidoIds debe ser una lista' })
  @ArrayMaxSize(MAXIMO_PEDIDOS_LIMPIEZA, {
    message: `pedidoIds admite hasta ${MAXIMO_PEDIDOS_LIMPIEZA} pedidos`,
  })
  @IsUUID('all', {
    each: true,
    message: 'cada elemento de pedidoIds debe ser un UUID',
  })
  pedidoIds?: string[];

  @IsOptional()
  @IsInt({ message: 'antiguedadHoras debe ser un número entero' })
  @Min(0, { message: 'antiguedadHoras no puede ser negativa' })
  @Max(ANTIGUEDAD_MAXIMA_HORAS, {
    message: `antiguedadHoras no puede ser mayor que ${ANTIGUEDAD_MAXIMA_HORAS}`,
  })
  antiguedadHoras?: number;

  @IsOptional()
  @IsBoolean({ message: 'dryRun debe ser verdadero o falso' })
  dryRun?: boolean;
}
