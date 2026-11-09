import { applyDecorators } from '@nestjs/common';
import { IsOptional, Matches } from 'class-validator';

/**
 * HU-022 (BL-494): `totalEsperado` de los cobros que registra el personal
 * (efectivo y POS).
 *
 * Es el total que el personal vio en pantalla (consumo + propina), como
 * texto («679» o «679.50») para no perder precisión. No define lo que se
 * cobra: es un control. Si el comensal cambió la propina mientras tanto y el
 * total ya no coincide, la API responde 409 y no cobra. Opcional: los
 * clientes anteriores no lo mandan.
 */
export function TotalEsperado() {
  return applyDecorators(
    IsOptional(),
    Matches(/^\d{1,8}(\.\d{1,2})?$/, {
      message:
        'totalEsperado debe ser un monto positivo, con hasta 2 decimales (por ejemplo, 1000 o 1000.50)',
    }),
  );
}
