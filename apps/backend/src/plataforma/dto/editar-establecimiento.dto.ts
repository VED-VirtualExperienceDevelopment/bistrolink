import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { limpiarEspacios } from '../../usuarios/dto/create-usuario.dto';
import { EsRutUruguayo } from '../rut';

/**
 * BL-412: PATCH /plataforma/establecimientos/:tenantId. Todos los campos son
 * opcionales: se cambia lo que viene. Que venga al menos uno lo controla el
 * servicio (400 «No hay cambios»), como en PATCH /usuarios/:id (BL-366).
 *
 * Mismas reglas que el alta (AprovisionarEstablecimientoDto). El RUT va sin
 * separadores y con el dígito verificador (BL-409); que no sea de otro
 * establecimiento lo controla el servicio (409).
 *
 * Reparto con HU-020 (BL-72): el RUT y el plan solo los cambia PLATAFORMA;
 * el resto también el ADMIN del restaurante. Lo aplica
 * DatosEstablecimientoService, que van a usar las dos entradas.
 */
export class EditarEstablecimientoDto {
  @IsOptional()
  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 200)
  razonSocial?: string;

  @IsOptional()
  @EsRutUruguayo()
  rut?: string;

  // Código interno del plan («BASICO»). Sigue como texto (decisión del
  // 21/10), pero con un formato fijo para que no entren «básico» o «Basico»
  // como planes distintos.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 30)
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'plan: en mayúsculas, con letras, números o guion bajo',
  })
  plan?: string;

  @IsOptional()
  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 120)
  restauranteNombre?: string;

  @IsOptional()
  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 200)
  restauranteDireccion?: string;
}
