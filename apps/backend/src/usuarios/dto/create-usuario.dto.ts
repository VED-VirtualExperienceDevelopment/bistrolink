import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
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
const MENSAJE_NOMBRE =
  'usá solo letras, espacios, apóstrofo, punto o guion, empezando con una letra';

/** Saca espacios de los extremos y deja uno solo entre palabras. */
const limpiarEspacios = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export class CreateUsuarioDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsOptional()
  @IsEmail()
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
