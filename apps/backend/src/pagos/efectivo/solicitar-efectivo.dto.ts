import { IsOptional, Matches } from 'class-validator';

/**
 * HU-031b (BL-442): el comensal de una mesa pide pagar en efectivo.
 * El total no viaja (se calcula en el backend, BL-90).
 */
export class SolicitarEfectivoDto {
  /**
   * Opcional: con cuánto va a pagar («1000» o «1000.50»), para que el mozo
   * lleve el cambio. Si viene, no puede ser menor al total.
   */
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message:
      'pagaCon debe ser un monto positivo, con hasta 2 decimales (por ejemplo, 1000 o 1000.50)',
  })
  pagaCon?: string;
}
