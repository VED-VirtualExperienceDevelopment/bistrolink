import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import {
  FORMATO_NOMBRE_PERSONA,
  limpiarEspacios,
  MENSAJE_NOMBRE,
  ROLES_VALIDOS,
} from './create-usuario.dto';

/**
 * PATCH /usuarios/:id. Todos los campos son opcionales: se cambia lo que
 * viene. BL-366 suma nombre, apellido y correo, con las mismas reglas que el
 * alta (BL-361). El usuario (login) no se edita.
 *
 * Que venga al menos un campo lo controla el servicio (400 «No hay cambios»).
 */
export class UpdateUsuarioDto {
  @IsOptional()
  @IsIn(ROLES_VALIDOS)
  rol?: (typeof ROLES_VALIDOS)[number];

  @IsOptional()
  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 60)
  @Matches(FORMATO_NOMBRE_PERSONA, { message: `nombre: ${MENSAJE_NOMBRE}` })
  nombre?: string;

  @IsOptional()
  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 60)
  @Matches(FORMATO_NOMBRE_PERSONA, { message: `apellido: ${MENSAJE_NOMBRE}` })
  apellido?: string;

  // El correo se puede cambiar, no borrar: el perfil del realm lo pide.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail({}, { message: 'email: tiene que ser un correo válido' })
  email?: string;
}
