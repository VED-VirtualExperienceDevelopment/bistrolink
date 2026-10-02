import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { MesaLayoutDto } from './mesa-layout.dto';

/**
 * Una mesa dentro del guardado masivo del mapa (POST /mesas/layout).
 *
 * - `id` presente → actualiza el layout de una mesa existente (debe
 *   pertenecer al mismo tenant + restaurante, se valida en el service).
 * - `id` ausente → crea una mesa nueva con ese `numero` y ese layout. Nace
 *   en estado LIBRE (mismo default que el alta manual de mesas).
 */
export class MesaLayoutItemDto extends MesaLayoutDto {
  @IsOptional()
  @IsUUID('loose') // ver ListarLayoutQueryDto
  id?: string;

  @IsInt()
  @Min(1, {
    message:
      'numero debe ser mayor a 0 (el 0 está reservado a la mesa virtual de HU-003)',
  })
  numero: number;
}

/**
 * Reemplaza al @ArrayMinSize(1) que tenía `mesas`: desde BL-58 un guardado
 * puede traer solo eliminaciones (por ejemplo, borrar la última mesa del
 * mapa), así que lo que no se admite es un guardado sin nada que hacer.
 */
@ValidatorConstraint({ name: 'mesasOEliminar' })
class MesasOEliminarConstraint implements ValidatorConstraintInterface {
  validate(mesas: unknown, args: ValidationArguments): boolean {
    const { eliminar } = args.object as GuardarLayoutDto;
    const hayMesas = Array.isArray(mesas) && mesas.length > 0;
    const hayEliminaciones = Array.isArray(eliminar) && eliminar.length > 0;
    return hayMesas || hayEliminaciones;
  }

  defaultMessage(): string {
    return 'el guardado tiene que incluir al menos una mesa para guardar o eliminar';
  }
}

export class GuardarLayoutDto {
  @IsUUID('loose') // ver ListarLayoutQueryDto
  restauranteId: string;

  @IsArray()
  @Validate(MesasOEliminarConstraint)
  @ArrayMaxSize(200, {
    message: 'no se pueden guardar más de 200 mesas por vez',
  })
  @ValidateNested({ each: true })
  @Type(() => MesaLayoutItemDto)
  mesas: MesaLayoutItemDto[];

  /**
   * BL-58: ids de mesas guardadas que el administrador quitó del mapa. Se
   * borran en la misma transacción que el resto del guardado, antes de
   * crear o actualizar (así se puede reusar el número de una mesa borrada).
   * Solo se pueden borrar mesas LIBRES y sin pedidos; si no, 409 (ver
   * MesasService.guardarLayout).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200, {
    message: 'no se pueden eliminar más de 200 mesas por vez',
  })
  @ArrayUnique({ message: 'eliminar no puede repetir ids' })
  @IsUUID('loose', { each: true }) // ver ListarLayoutQueryDto
  eliminar?: string[];
}
