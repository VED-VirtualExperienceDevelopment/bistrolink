import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export const ROLES_VALIDOS = ['ADMIN', 'MOZO'] as const;
// Nota: COCINA y COMENSAL son roles de Keycloak pero no tienen fila propia en
// la tabla `usuario` (Anexo 6 §4.3) — este endpoint solo gestiona identidades
// con representación en Postgres (Admin y Mozo).

/**
 * BL-361: nombre o apellido de una persona. Empieza con una letra y después
 * admite letras (con tildes), espacios, apóstrofo, punto y guion: «María
 * José», «O'Neill», «Pérez-Núñez». Deja afuera los caracteres que rechaza el
 * validador de nombres de Keycloak (< > & / $ % etc.), para que un nombre
 * inválido sea un 400 claro y no un 500 de Keycloak.
 */
export const FORMATO_NOMBRE_PERSONA = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
export const MENSAJE_NOMBRE =
  'usá solo letras, espacios, apóstrofo, punto o guion, empezando con una letra';

/**
 * BL-356 (H-02 de la auditoría): nombre de usuario (el login). De 3 a 30
 * caracteres, empieza con una letra y después admite minúsculas, números,
 * punto, guion y guion bajo. Deja afuera los usuarios solo numéricos, que
 * cuestan identificar en el listado y llevan a usar datos personales (un
 * número de documento) como usuario. Keycloak guarda el usuario en
 * minúsculas, así que se normaliza antes de validar.
 */
export const FORMATO_USERNAME = /^[a-z][a-z0-9._-]{2,29}$/;
export const MENSAJE_USERNAME =
  'de 3 a 30 caracteres, empezando con una letra; solo minúsculas, números, punto, guion o guion bajo';

/**
 * BL-356: largo máximo de un correo (RFC 5321). Sin este tope, un correo más
 * largo llegaba a Keycloak, que lo rechaza con un 500 en lugar de un 400.
 */
export const LARGO_MAXIMO_EMAIL = 254;
export const MENSAJE_EMAIL_LARGO = `email: puede tener hasta ${LARGO_MAXIMO_EMAIL} caracteres`;

/** Saca los espacios de los extremos y pasa el usuario a minúsculas. */
export const normalizarUsername = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Saca espacios de los extremos y deja uno solo entre palabras. */
export const limpiarEspacios = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateUsuarioDto {
  @Transform(normalizarUsername)
  @IsString()
  @Matches(FORMATO_USERNAME, { message: `username: ${MENSAJE_USERNAME}` })
  username: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(LARGO_MAXIMO_EMAIL, { message: MENSAJE_EMAIL_LARGO })
  email?: string;

  // BL-361: obligatorios, para que el listado y el encabezado (BL-350)
  // muestren «Juan Pérez» y no el usuario.
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

  @IsIn(ROLES_VALIDOS)
  rol: (typeof ROLES_VALIDOS)[number];

  // Un tenant puede tener más de un Restaurante (Anexo 6 §4.2) — el alta
  // debe indicar a cuál queda asociado el usuario.
  // 'loose': el restaurante de testing A (2222…) no es RFC 4122; ver
  // ListarLayoutQueryDto.
  @IsUUID('loose')
  restauranteId: string;
}
