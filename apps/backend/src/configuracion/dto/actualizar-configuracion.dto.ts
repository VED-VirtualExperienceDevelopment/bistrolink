import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CfeProveedor } from '@prisma/client';
import { limpiarEspacios } from '../../usuarios/dto/create-usuario.dto';
import {
  MINUTOS_ESPERA_MAXIMO,
  MINUTOS_ESPERA_MINIMO,
} from '../../pedidos/umbrales-espera';
import { PLANTILLAS_MARCA, type PlantillaMarca } from '../plantillas-marca';

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

/**
 * HU-020 (BL-72): medios de pago que se pueden habilitar hoy. Mercado Pago
 * es la única pasarela (decisión del 17/10/2026, Anexo 2): Plexo y Handy
 * quedaron fuera del MVP (BL-452). Tienen su columna (en false) pero no se
 * pueden habilitar hasta que exista su integración. Para habilitar uno,
 * alcanza con sumarlo acá; la pantalla toma la lista de GET
 * /admin/configuracion.
 */
export const MEDIOS_PAGO_DISPONIBLES = [
  'EFECTIVO',
  'MERCADOPAGO',
  // HU-007b (BL-80): cobro con el POS del local, que registra el mozo.
  'POS',
] as const;
export type MedioPagoConfigurable =
  (typeof MEDIOS_PAGO_DISPONIBLES)[number] | 'PLEXO' | 'HANDY';

/** Valores aceptados para el flag de un medio: false si no está disponible. */
function valoresPermitidos(medio: MedioPagoConfigurable): boolean[] {
  return (MEDIOS_PAGO_DISPONIBLES as readonly MedioPagoConfigurable[]).includes(
    medio,
  )
    ? [true, false]
    : [false];
}

/**
 * HU-042 (BL-465): rangos de la cola del KDS. Los mismos que los CHECK de la
 * migración 20261105120000_kds_cola_pedidos; pensados para locales chicos y
 * medianos (se amplían si hace falta).
 */
export const LIMITE_PREPARACION_MINIMO = 1;
export const LIMITE_PREPARACION_MAXIMO = 50;
export const UMBRAL_ALERTA_COLA_MINIMO = 1;
export const UMBRAL_ALERTA_COLA_MAXIMO = 200;
export const MINUTOS_PREPARACION_MINIMO = 1;
export const MINUTOS_PREPARACION_MAXIMO = 180;

/** HU-036 (BL-206): largo máximo de un correo (RFC 5321) y de la columna. */
export const LARGO_MAXIMO_EMAIL = 254;

/**
 * HU-043 (BL-561): largos del nombre y la dirección del local, los mismos
 * que usa Plataforma (EditarEstablecimientoDto, BL-412).
 */
export const LARGO_MAXIMO_NOMBRE_LOCAL = 120;
export const LARGO_MAXIMO_DIRECCION_LOCAL = 200;

/** HU-043 (BL-532): el mismo largo máximo que la key de una imagen confirmada. */
export const LARGO_MAXIMO_KEY_LOGO = 200;

/** Sin espacios y en minúsculas; vacío = quitarlo (null). */
const normalizarEmail = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const limpio = value.trim().toLowerCase();
  return limpio === '' ? null : limpio;
};

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

  // HU-043 (BL-561): nombre y dirección del local, los que ven los
  // comensales en la carta y en la política de privacidad. Mismas reglas
  // que Plataforma (BL-412). Opcionales, pero nunca null (NOT NULL).
  @ValidateIf((_dto, valor) => valor !== undefined)
  @Transform(limpiarEspacios)
  @IsString({ message: 'El nombre del local debe ser texto' })
  @Length(1, LARGO_MAXIMO_NOMBRE_LOCAL, {
    message: `El nombre del local debe tener entre 1 y ${LARGO_MAXIMO_NOMBRE_LOCAL} caracteres`,
  })
  nombre?: string;

  @ValidateIf((_dto, valor) => valor !== undefined)
  @Transform(limpiarEspacios)
  @IsString({ message: 'La dirección del local debe ser texto' })
  @Length(1, LARGO_MAXIMO_DIRECCION_LOCAL, {
    message: `La dirección del local debe tener entre 1 y ${LARGO_MAXIMO_DIRECCION_LOCAL} caracteres`,
  })
  direccion?: string;

  // Medios de pago. efectivoHabilitado es la columna de HU-031 (BL-201).
  @IsOptional()
  @IsBoolean({ message: 'efectivoHabilitado debe ser verdadero o falso' })
  efectivoHabilitado?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'mercadoPagoHabilitado debe ser verdadero o falso' })
  mercadoPagoHabilitado?: boolean;

  // HU-007b (BL-80): cobros con el POS del local.
  @IsOptional()
  @IsBoolean({ message: 'posHabilitado debe ser verdadero o falso' })
  posHabilitado?: boolean;

  // Plexo y Handy, fuera del MVP (BL-452): solo se acepta false hasta que
  // estén disponibles.
  @IsOptional()
  @IsBoolean({ message: 'plexoHabilitado debe ser verdadero o falso' })
  @IsIn(valoresPermitidos('PLEXO'), {
    message: 'Plexo todavía no está disponible: no se puede habilitar',
  })
  plexoHabilitado?: boolean;

  @IsOptional()
  @IsBoolean({ message: 'handyHabilitado debe ser verdadero o falso' })
  @IsIn(valoresPermitidos('HANDY'), {
    message: 'Handy todavía no está disponible: no se puede habilitar',
  })
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

  // HU-022 (BL-495): la pantalla de pago del comensal abre con el 10 % marcado
  // como «Sugerida». Solo surte efecto si el 10 % está en propinasSugeridas;
  // si no está, la opción queda activa y no se marca nada.
  @IsOptional()
  @IsBoolean({ message: 'propinaPreseleccionada debe ser verdadero o falso' })
  propinaPreseleccionada?: boolean;

  @IsOptional()
  @IsIn(PROVEEDORES_CFE_DISPONIBLES, {
    message: `Proveedor de CFE no disponible. Hoy se puede elegir: ${PROVEEDORES_CFE_DISPONIBLES.join(', ')}`,
  })
  cfeProveedor?: CfeProveedor;

  // HU-036 (BL-206): correo para que los comensales ejerzan sus derechos
  // sobre sus datos personales (Ley 18.331). Vacío o null lo quita.
  @IsOptional()
  @Transform(normalizarEmail)
  @ValidateIf((_dto, valor) => valor !== null)
  @IsEmail({}, { message: 'El correo de privacidad no es válido' })
  @MaxLength(LARGO_MAXIMO_EMAIL, {
    message: `El correo de privacidad puede tener hasta ${LARGO_MAXIMO_EMAIL} caracteres`,
  })
  emailPrivacidad?: string | null;

  // HU-042 (BL-465, ADR 0010): cola del KDS. null desactiva la cola
  // automática (el mozo pasa los pedidos a preparación a mano, como antes).
  @IsOptional()
  @ValidateIf((_dto, valor) => valor !== null)
  @IsInt({
    message: 'El límite de pedidos en preparación debe ser un número entero',
  })
  @Min(LIMITE_PREPARACION_MINIMO, {
    message: `El límite de pedidos en preparación debe ser al menos ${LIMITE_PREPARACION_MINIMO}`,
  })
  @Max(LIMITE_PREPARACION_MAXIMO, {
    message: `El límite de pedidos en preparación puede ser como máximo ${LIMITE_PREPARACION_MAXIMO}`,
  })
  limitePedidosEnPreparacion?: number | null;

  // Opcional, pero nunca null: la columna es NOT NULL (IsOptional
  // dejaría pasar null).
  @ValidateIf((_dto, valor) => valor !== undefined)
  @IsInt({
    message: 'El umbral de alerta de la cola debe ser un número entero',
  })
  @Min(UMBRAL_ALERTA_COLA_MINIMO, {
    message: `El umbral de alerta de la cola debe ser al menos ${UMBRAL_ALERTA_COLA_MINIMO}`,
  })
  @Max(UMBRAL_ALERTA_COLA_MAXIMO, {
    message: `El umbral de alerta de la cola puede ser como máximo ${UMBRAL_ALERTA_COLA_MAXIMO}`,
  })
  umbralAlertaCola?: number;

  // Opcional, pero nunca null: la columna es NOT NULL (IsOptional
  // dejaría pasar null).
  @ValidateIf((_dto, valor) => valor !== undefined)
  @IsInt({
    message: 'Los minutos de preparación estimados deben ser un número entero',
  })
  @Min(MINUTOS_PREPARACION_MINIMO, {
    message: `Los minutos de preparación estimados deben ser al menos ${MINUTOS_PREPARACION_MINIMO}`,
  })
  @Max(MINUTOS_PREPARACION_MAXIMO, {
    message: `Los minutos de preparación estimados pueden ser como máximo ${MINUTOS_PREPARACION_MAXIMO}`,
  })
  minutosPreparacionEstimados?: number;

  // HU-038 (BL-506): umbrales de espera de las comandas del KDS. Opcionales,
  // pero nunca null (columnas NOT NULL). Que queden de menor a mayor lo
  // controla el servicio, con lo que ya está guardado: el PATCH es parcial.
  @ValidateIf((_dto, valor) => valor !== undefined)
  @IsInt({ message: '«Atención desde» debe ser un número entero de minutos' })
  @Min(MINUTOS_ESPERA_MINIMO, {
    message: `«Atención desde» debe ser al menos ${MINUTOS_ESPERA_MINIMO} minuto`,
  })
  @Max(MINUTOS_ESPERA_MAXIMO, {
    message: `«Atención desde» puede ser como máximo ${MINUTOS_ESPERA_MAXIMO} minutos`,
  })
  minutosEsperaAtencion?: number;

  @ValidateIf((_dto, valor) => valor !== undefined)
  @IsInt({ message: '«Demorado desde» debe ser un número entero de minutos' })
  @Min(MINUTOS_ESPERA_MINIMO, {
    message: `«Demorado desde» debe ser al menos ${MINUTOS_ESPERA_MINIMO} minuto`,
  })
  @Max(MINUTOS_ESPERA_MAXIMO, {
    message: `«Demorado desde» puede ser como máximo ${MINUTOS_ESPERA_MAXIMO} minutos`,
  })
  minutosEsperaDemorado?: number;

  @ValidateIf((_dto, valor) => valor !== undefined)
  @IsInt({
    message: '«Demora alta desde» debe ser un número entero de minutos',
  })
  @Min(MINUTOS_ESPERA_MINIMO, {
    message: `«Demora alta desde» debe ser al menos ${MINUTOS_ESPERA_MINIMO} minuto`,
  })
  @Max(MINUTOS_ESPERA_MAXIMO, {
    message: `«Demora alta desde» puede ser como máximo ${MINUTOS_ESPERA_MAXIMO} minutos`,
  })
  minutosEsperaDemoraAlta?: number;

  // HU-043 (BL-531): plantilla de colores de la carta. Opcional, pero nunca
  // null (columna NOT NULL). La base tiene el mismo control (CHECK).
  @ValidateIf((_dto, valor) => valor !== undefined)
  @IsIn(PLANTILLAS_MARCA, {
    message: `Plantilla no disponible. Se puede elegir: ${PLANTILLAS_MARCA.join(', ')}`,
  })
  plantilla?: PlantillaMarca;

  // HU-043 (BL-532): logo del local. Es la key que devuelve
  // POST /admin/menu/imagenes/confirmar con destino `marca`. Que sea un logo
  // publicado de este establecimiento lo controla el servicio (400 si no).
  // null quita el logo.
  @IsOptional()
  @ValidateIf((_dto, valor) => valor !== null)
  @IsString({ message: 'El logo debe ser la key de una imagen confirmada' })
  @MaxLength(LARGO_MAXIMO_KEY_LOGO, {
    message: `La key del logo puede tener hasta ${LARGO_MAXIMO_KEY_LOGO} caracteres`,
  })
  logoKey?: string | null;
}
