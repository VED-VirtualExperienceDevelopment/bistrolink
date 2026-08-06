import { IsIn } from 'class-validator';
import { ROLES_VALIDOS } from './create-usuario.dto';

export class UpdateUsuarioDto {
  @IsIn(ROLES_VALIDOS)
  rol: (typeof ROLES_VALIDOS)[number];
}
