import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import {
  FORMATO_NOMBRE_PERSONA,
  FORMATO_USERNAME,
  LARGO_MAXIMO_EMAIL,
  limpiarEspacios,
  MENSAJE_EMAIL_LARGO,
  MENSAJE_NOMBRE,
  MENSAJE_USERNAME,
  normalizarUsername,
} from '../../usuarios/dto/create-usuario.dto';

/**
 * BL-414: body de POST /plataforma/establecimientos/:tenantId/administradores.
 *
 * Mismas reglas que el alta de usuarios del restaurante (CreateUsuarioDto),
 * con dos diferencias:
 * - El rol y el restaurante no vienen en el body: siempre es ADMIN, y el
 *   restaurante es el del establecimiento (lo busca el servicio).
 * - El correo es obligatorio, como el del Administrador del alta
 *   (AdminAltaDto): el perfil de usuario del realm lo exige, y sin él
 *   Keycloak frena el primer ingreso con «Update Account Information».
 */
export class CrearAdministradorDto {
  @Transform(normalizarUsername)
  @IsString()
  @Matches(FORMATO_USERNAME, { message: `username: ${MENSAJE_USERNAME}` })
  username: string;

  @IsEmail()
  @MaxLength(LARGO_MAXIMO_EMAIL, { message: MENSAJE_EMAIL_LARGO })
  email: string;

  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 60)
  @Matches(FORMATO_NOMBRE_PERSONA, { message: `nombre: ${MENSAJE_NOMBRE}` })
  nombre: string;

  @Transform(limpiarEspacios)
  @IsString()
  @Length(1, 60)
  @Matches(FORMATO_NOMBRE_PERSONA, { message: `apellido: ${MENSAJE_NOMBRE}` })
  apellido: string;
}
