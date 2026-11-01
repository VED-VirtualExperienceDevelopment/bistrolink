import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CfeProveedor } from '@prisma/client';
import { limpiarEspacios } from '../../usuarios/dto/create-usuario.dto';

/** HU-020 (BL-72): hasta cuántos porcentajes de propina se sugieren. */
export const MAXIMO_PROPINAS_SUGERIDAS = 5;
export const PROPINA_MINIMA = 1;
export const PROPINA_MAXIMA = 100;

/**
 * HU-020 (BL-72): proveedores de CFE que se pueden elegir hoy. Biller quedó
 * fuera del MVP: está en el enum (la base ya lo admite) pero no se puede
 * elegir hasta que exista su integración. Para habilitarlo, alcanza con
 * sumarlo acá; la pantalla toma la lista de GET /admin/configuracion.
 */
export const PROVEEDORES_CFE_DISPONIBLES: readonly CfeProveedor[] = [
  CfeProveedor.SURTEC,
];

/** Ordena de menor a mayor (si es una lista de números), para guardar siempre igual. */
const ordenarPropinas = ({ value }: { value: unknown }) =>
  Array.isArray(value) && value.every((v) => typeof v === 'number')
    ? [...value].sort((a: number, b: number) => a - b)
    : value;

/**
 * HU-020 (BL-72): PATCH /admin/configuracion. Todos los campos son
 * opcionales: se cambia lo que viene. Que venga al menos uno lo controla el
 * servicio (400 «No hay cambios»), como en PATCH /usuarios/:id (BL-366).
 *
 * No tiene `rut`: el RUT solo lo cambia la plataforma (BL-412). Como la API
 * rechaza propiedades de más (forbidNonWhitelisted), mandarlo da 400.
 */
export class ActualizarConfiguracionDto {
  // Mismas reglas que EditarEstablecimientoDto (BL-412).
  @IsOptional()
  @Transform(limpiarEspacios)
  @IsString({ message: 'La razón social debe ser texto' })
  @Length(1, 200, {
    message: 'La razón social debe tener entre 1 y 200 caracteres',
  })
  razonSocial?: string;

  // Medios de pago. efectivoHabilitado es la columna de HU-031 (BL-201).
  @IsOptional()
  @IsBoolean({ message: 'efectivoHabilitado debe ser verdadero o falso' })
  efectivoHabilitado?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'mercadoPagoHabilitado debe ser verdadero o falso' })
  mercadoPagoHabilitado?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'plexoHabilitado debe ser verdadero o falso' })
  plexoHabilitado?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'handyHabilitado debe ser verdadero o falso' })
  handyHabilitado?: boolean;

  // Porcentajes enteros, sin repetir, de menor a mayor. La lista vacía
  // quita las sugerencias. La base tiene el mismo control (CHECK).
  @IsOptional()
  @Transform(ordenarPropinas)
  @IsArray({ message: 'Las propinas sugeridas deben ser una lista' })
  @ArrayMaxSize(MAXIMO_PROPINAS_SUGERIDAS, {
    message: `Se pueden sugerir hasta ${MAXIMO_PROPINAS_SUGERIDAS} porcentajes de propina`,
  })
  @ArrayUnique({ message: 'Los porcentajes de propina no se pueden repetir' })
  @IsInt({
    each: true,
    message: 'Cada porcentaje de propina debe ser un número entero',
  })
  @Min(PROPINA_MINIMA, {
    each: true,
    message: `Cada porcentaje de propina debe ser al menos ${PROPINA_MINIMA}`,
  })
  @Max(PROPINA_MAXIMA, {
    each: true,
    message: `Cada porcentaje de propina debe ser como máximo ${PROPINA_MAXIMA}`,
  })
  propinasSugeridas?: number[];

  @IsOptional()
  @IsIn(PROVEEDORES_CFE_DISPONIBLES, {
    message: `Proveedor de CFE no disponible. Hoy se puede elegir: ${PROVEEDORES_CFE_DISPONIBLES.join(', ')}`,
  })
  cfeProveedor?: CfeProveedor;
}
