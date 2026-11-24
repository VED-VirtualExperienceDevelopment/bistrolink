import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * HU-022 (BL-494): lo que el comensal elige antes de pagar. Como mucho uno de
 * los dos (lo valida el servicio); ninguno = sin propina. El monto en pesos
 * de la propina NUNCA viaja: lo calcula el backend (BL-90).
 */
export class ElegirPropinaDto {
  /** Porcentaje del consumo, entero de 1 a 100. */
  @IsOptional()
  @IsInt({ message: 'porcentaje debe ser un número entero' })
  @Min(1, { message: 'porcentaje debe ser de 1 a 100' })
  @Max(100, { message: 'porcentaje debe ser de 1 a 100' })
  porcentaje?: number | null;

  /** Monto libre en pesos enteros, desde $ 1 (el tope lo valida el servicio). */
  @IsOptional()
  @IsInt({ message: 'monto debe ser un número entero de pesos' })
  @Min(1, { message: 'monto debe ser de al menos $ 1' })
  @Max(99_999_999, { message: 'monto es demasiado alto' })
  monto?: number | null;
}
