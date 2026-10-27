import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

/**
 * BL-418: DELETE /plataforma/establecimientos/:tenantId. El RUT del
 * establecimiento, escrito a mano en la confirmación (patrón de borrado
 * irreversible). Si no coincide con el guardado, el servicio responde 400.
 *
 * No se valida el formato del RUT: alcanza con que sea igual al del
 * establecimiento. Se sacan los espacios de los bordes, por si se pegó.
 */
export class EliminarEstablecimientoDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'El RUT es obligatorio' })
  @MaxLength(20)
  rut!: string;
}
