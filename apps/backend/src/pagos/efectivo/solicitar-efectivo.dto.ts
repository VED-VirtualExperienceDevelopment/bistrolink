import { Type } from 'class-transformer';
import { IsOptional, Matches, ValidateNested } from 'class-validator';
import { ReceptorFiscalDto } from '../../cfe/receptor-fiscal';

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

  /**
   * HU-009 (BL-453): e-Factura con RUT y razón social. Sin el campo, el
   * pedido queda como estaba (por ejemplo, al avisar de nuevo al mozo).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceptorFiscalDto)
  receptorFiscal?: ReceptorFiscalDto | null;
}
