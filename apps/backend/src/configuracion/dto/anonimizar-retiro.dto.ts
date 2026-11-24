import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { normalizarContactoRetiro } from '../../pedidos/retiro';

/**
 * HU-040 (BL-210): contacto (teléfono o correo) del comensal que pidió
 * anonimizar sus datos de un pedido para retirar. Se normaliza igual que al
 * guardarlo: un correo en minúsculas, un teléfono solo con dígitos.
 */
export class AnonimizarRetiroDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizarContactoRetiro(value) : value,
  )
  @IsString({ message: 'El contacto debe ser texto' })
  @Length(3, 100, {
    message: 'El contacto debe tener entre 3 y 100 caracteres',
  })
  contacto: string;
}
