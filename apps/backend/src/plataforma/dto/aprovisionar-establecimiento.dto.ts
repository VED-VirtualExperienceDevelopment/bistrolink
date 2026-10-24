import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  LARGO_MAXIMO_EMAIL,
  MENSAJE_EMAIL_LARGO,
} from '../../usuarios/dto/create-usuario.dto';
import { EsRutUruguayo } from '../rut';

/**
 * BL-163 (HU-027): datos de un establecimiento nuevo. Los usa el script de
 * aprovisionamiento (entrega 1) y los va a usar el endpoint de plataforma
 * (entrega 2), así la validación es la misma por las dos entradas.
 *
 * Las contraseñas NO forman parte del DTO: se pasan aparte al servicio, para
 * que nunca viajen dentro de un objeto que alguien pueda loguear entero.
 */

// Keycloak guarda los username en minúsculas; se exige el formato desde la
// entrada para que la búsqueda exacta (findUserByUsername) sea confiable.
// BL-356 (H-02): empieza con una letra, igual que el alta de usuarios
// (FORMATO_USERNAME en create-usuario.dto.ts), para que no se pueda crear un
// Administrador o una Cocina solo numéricos. El tope sigue en 50 (no 30)
// para que el alta, que es idempotente, siga aceptando las cuentas ya creadas.
const FORMATO_USERNAME = /^[a-z][a-z0-9._-]{2,49}$/;
const MENSAJE_USERNAME =
  'username: de 3 a 50 caracteres, empezando con una letra; en minúsculas, con letras, números, punto, guion o guion bajo';

export class RestauranteAltaDto {
  /** Opcional: los tenants de testing usan ids fijos (los tests los tienen hardcodeados). */
  @IsOptional()
  @IsUUID('loose') // mismo criterio que ListarLayoutQueryDto (ids del seed)
  id?: string;

  @IsString()
  @Length(1, 120)
  nombre: string;

  @IsString()
  @Length(1, 200)
  direccion: string;

  /** Por defecto America/Montevideo. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;
}

/**
 * Cuenta Cocina: es compartida (no es una persona). Si no viene email, se
 * usa uno técnico; nombre y apellido son fijos.
 */
export class UsuarioAltaDto {
  @Matches(FORMATO_USERNAME, { message: MENSAJE_USERNAME })
  username: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(LARGO_MAXIMO_EMAIL, { message: MENSAJE_EMAIL_LARGO })
  email?: string;
}

/**
 * El perfil de usuario del realm exige email, nombre y apellido: sin ellos,
 * Keycloak frena el primer login con el formulario "Update Account
 * Information". El Administrador es una persona, así que se piden en el alta.
 */
export class AdminAltaDto {
  @Matches(FORMATO_USERNAME, { message: MENSAJE_USERNAME })
  username: string;

  @IsEmail()
  @MaxLength(LARGO_MAXIMO_EMAIL, { message: MENSAJE_EMAIL_LARGO })
  email: string;

  @IsString()
  @Length(1, 80)
  nombre: string;

  @IsString()
  @Length(1, 80)
  apellido: string;
}

export class AprovisionarEstablecimientoDto {
  /**
   * Opcional. Si no viene, el servicio busca el tenant por RUT y, si no
   * existe, lo crea con un id nuevo.
   */
  @IsOptional()
  @IsUUID('loose')
  tenantId?: string;

  @IsString()
  @Length(1, 200)
  razonSocial: string;

  /**
   * RUT de Uruguay: 12 dígitos con el dígito verificador (BL-409). Es único
   * por tenant (idempotencia del alta).
   */
  @EsRutUruguayo()
  rut: string;

  /** Por defecto BASICO. */
  @IsOptional()
  @IsString()
  @Length(1, 30)
  plan?: string;

  // @ValidateNested solo valida lo que viene: @IsDefined/@IsObject hacen
  // obligatorio el objeto (sin ellos, un alta sin restaurante pasaba).
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RestauranteAltaDto)
  restaurante: RestauranteAltaDto;

  /** Administrador inicial: Keycloak + fila en `usuario`. */
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AdminAltaDto)
  admin: AdminAltaDto;

  /** Cuenta Cocina (KDS): solo Keycloak, sin fila en `usuario` (Anexo 6 §4.3). */
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UsuarioAltaDto)
  cocina: UsuarioAltaDto;
}
