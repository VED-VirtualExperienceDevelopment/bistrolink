import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

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

/** BL-489: medios que acepta la simulación del POS de prueba. */
export const MEDIOS_VENTA_POS = ['EFECTIVO', 'CREDITO', 'DEBITO'] as const;
export type MedioVentaPos = (typeof MEDIOS_VENTA_POS)[number];

/**
 * POST /admin/pos/ventas/simular (BL-489): una venta en el POS de prueba,
 * para la demo. Pesos con hasta 2 decimales.
 */
export class SimularVentaPosDto {
  @Type(() => Number)
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'total debe ser un número con hasta 2 decimales' },
  )
  @Min(1, { message: 'total debe ser 1 o más' })
  @Max(100000, { message: 'total debe ser 100000 o menos' })
  total!: number;

  @IsIn(MEDIOS_VENTA_POS, {
    message: `medioPago debe ser uno de: ${MEDIOS_VENTA_POS.join(', ')}`,
  })
  medioPago!: MedioVentaPos;
}
