import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** HU-024 (BL-104): motivos de cancelación de un pedido pagado. */
export const MOTIVOS_CANCELACION = {
  ERROR_PEDIDO: 'Error en el pedido',
  RECLAMO_CLIENTE: 'Reclamo del cliente',
  PRODUCTO_NO_DISPONIBLE: 'Producto no disponible',
  COBRO_DUPLICADO: 'Cobro duplicado',
  OTRO: 'Otro',
} as const;
export type MotivoCancelacion = keyof typeof MOTIVOS_CANCELACION;

export const LARGO_MAXIMO_DETALLE_CANCELACION = 200;

const limpiar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/**
 * HU-024 (BL-104): POST /pedidos/:pedidoId/cancelacion. El monto no viaja:
 * la cancelación es siempre total y se devuelve lo que se cobró.
 */
export class CancelarPedidoDto {
  @IsIn(Object.keys(MOTIVOS_CANCELACION), {
    message: `motivo debe ser uno de: ${Object.keys(MOTIVOS_CANCELACION).join(', ')}`,
  })
  motivo: MotivoCancelacion;

  /** Texto libre; obligatorio con el motivo «Otro». */
  @ValidateIf(
    (dto: CancelarPedidoDto) =>
      dto.motivo === 'OTRO' || dto.detalle !== undefined,
  )
  @Transform(limpiar)
  @IsString({ message: 'Contá brevemente el motivo de la cancelación' })
  @IsNotEmpty({ message: 'Contá brevemente el motivo de la cancelación' })
  @MaxLength(LARGO_MAXIMO_DETALLE_CANCELACION, {
    message: `El detalle puede tener hasta ${LARGO_MAXIMO_DETALLE_CANCELACION} caracteres`,
  })
  detalle?: string;

  /**
   * Para pagos en efectivo o con el POS del local, que BistroLink no puede
   * devolver solo: el mozo confirma que devolvió el efectivo o anuló el
   * cobro en el POS.
   */
  @IsOptional()
  @IsBoolean({
    message: 'devolucionManualConfirmada debe ser verdadero o falso',
  })
  devolucionManualConfirmada?: boolean;
}
