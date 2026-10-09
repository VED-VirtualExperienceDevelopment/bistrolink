import { IsEmail, IsString, Length, Matches } from 'class-validator';

/**
 * BL-163 (HU-027): un usuario de plataforma por persona del equipo, con el
 * formato dev-<nombre>-plataforma (por ejemplo dev-daiana-plataforma). El
 * formato fijo hace que en Keycloak y en la auditoría se vea de un vistazo
 * que es una cuenta de plataforma y de quién es.
 */
export const FORMATO_USERNAME_PLATAFORMA =
  /^dev-[a-z0-9]+(-[a-z0-9]+)*-plataforma$/;

export class CrearUsuarioPlataformaDto {
  @Matches(FORMATO_USERNAME_PLATAFORMA, {
    message:
      'username: tiene que tener el formato dev-<nombre>-plataforma, en minúsculas',
  })
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @Length(1, 80)
  nombre: string;

  @IsString()
  @Length(1, 80)
  apellido: string;
}
