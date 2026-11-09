import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/**
 * HU-031 (BL-201): cobro en efectivo que registra el mozo o el administrador.
 *
 * El total NO viaja en el body (igual que en el pago con tarjeta, BL-90): se
 * calcula en el backend con las líneas del pedido y la propina que eligió el
 * comensal (HU-022). Solo viaja lo que el comensal entregó, para calcular el
 * vuelto.
 */
export class RegistrarCobroEfectivoDto {
  @IsUUID('4', { message: 'pedidoId debe tener formato UUID' })
  pedidoId: string;

  /**
   * La genera el frontend una vez por cobro y la reenvía igual si reintenta:
   * un doble clic o un reintento no registra dos cobros (RNF.03).
   */
  @IsString()
  @Length(1, 64)
  idempotencyKey: string;

  /**
   * Monto que entregó el comensal, como texto («1000» o «1000.50») para no
   * perder precisión. Sin signo: nunca negativo.
   */
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message:
      'montoRecibido debe ser un monto positivo, con hasta 2 decimales (por ejemplo, 1000 o 1000.50)',
  })
  montoRecibido: string;

  /**
   * HU-022 (BL-494): el total que el personal vio en pantalla (consumo +
   * propina). No define lo que se cobra: es un control. Si el comensal cambió
   * la propina mientras tanto y el total ya no coincide, la API responde 409
   * y no cobra. Opcional.
   */
  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/, {
    message:
      'totalEsperado debe ser un monto positivo, con hasta 2 decimales (por ejemplo, 1000 o 1000.50)',
  })
  totalEsperado?: string;
}
