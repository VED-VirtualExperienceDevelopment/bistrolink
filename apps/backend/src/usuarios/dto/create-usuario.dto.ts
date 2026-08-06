import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export const ROLES_VALIDOS = ['ADMIN', 'MOZO'] as const;
// Nota: COCINA y COMENSAL son roles de Keycloak pero no tienen fila propia en
// la tabla `usuario` (Anexo 6 §4.3) — este endpoint solo gestiona identidades
// con representación en Postgres (Admin y Mozo).

export class CreateUsuarioDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsIn(ROLES_VALIDOS)
  rol: (typeof ROLES_VALIDOS)[number];

  // Un tenant puede tener más de un Restaurante (Anexo 6 §4.2) — el alta
  // debe indicar a cuál queda asociado el usuario.
  @IsUUID()
  restauranteId: string;
}
