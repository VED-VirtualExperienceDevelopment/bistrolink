import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COORDENADA_MAXIMA_MESA,
  DIMENSION_MAXIMA_MESA,
} from './mesa-layout.dto';

/**
 * HU-028 (BL-173): plano completo del salón. Se guarda en
 * restaurante.plano (JSONB) y no toca el layout de las mesas (mesa.layout).
 *
 * Mismo criterio que MesaLayoutDto: x / y son el CENTRO del elemento o de la
 * zona, y los topes son holgados (solo frenan payloads que el editor no
 * podría generar). El JSON pasa por el ValidationPipe global con whitelist y
 * forbidNonWhitelisted, así que no se persiste ninguna propiedad extra.
 */

export const TIPOS_ELEMENTO_PLANO = [
  'PUERTA',
  'BANO',
  'COCINA',
  'CAJA',
  'BARRA',
] as const;
export type TipoElementoPlano = (typeof TIPOS_ELEMENTO_PLANO)[number];

export const MAXIMO_ELEMENTOS_PLANO = 100;
export const MAXIMO_ZONAS_PLANO = 30;
export const LARGO_MAXIMO_ETIQUETA_ZONA = 30;

/**
 * Una zona puede abarcar buena parte del salón, así que admite más que una
 * mesa (DIMENSION_MAXIMA_MESA). Igual queda acotada por el rango de
 * coordenadas.
 */
export const DIMENSION_MAXIMA_ZONA = 5_000;

/** Letras (con tildes y ñ), números, espacios y . , ' ( ) - */
const ETIQUETA_PERMITIDA = /^[\p{L}\p{N} .,'()-]+$/u;

class FormaEnPlanoDto {
  // Lo genera el editor (crypto.randomUUID) para poder identificar cada
  // elemento al moverlo. 'loose': mismo criterio que ListarLayoutQueryDto.
  @IsUUID('loose')
  id: string;

  @IsNumber()
  @Min(-COORDENADA_MAXIMA_MESA)
  @Max(COORDENADA_MAXIMA_MESA, {
    message: `x debe estar entre -${COORDENADA_MAXIMA_MESA} y ${COORDENADA_MAXIMA_MESA}`,
  })
  x: number;

  @IsNumber()
  @Min(-COORDENADA_MAXIMA_MESA)
  @Max(COORDENADA_MAXIMA_MESA, {
    message: `y debe estar entre -${COORDENADA_MAXIMA_MESA} y ${COORDENADA_MAXIMA_MESA}`,
  })
  y: number;
}

export class ElementoPlanoDto extends FormaEnPlanoDto {
  @IsIn(TIPOS_ELEMENTO_PLANO, {
    message: `tipo debe ser uno de: ${TIPOS_ELEMENTO_PLANO.join(', ')}`,
  })
  tipo: TipoElementoPlano;

  @IsNumber()
  @Min(1, { message: 'ancho debe ser mayor a 0' })
  @Max(DIMENSION_MAXIMA_MESA, {
    message: `ancho no puede superar ${DIMENSION_MAXIMA_MESA}`,
  })
  ancho: number;

  @IsNumber()
  @Min(1, { message: 'alto debe ser mayor a 0' })
  @Max(DIMENSION_MAXIMA_MESA, {
    message: `alto no puede superar ${DIMENSION_MAXIMA_MESA}`,
  })
  alto: number;

  @IsNumber()
  @Min(0)
  @Max(359, { message: 'rotacion debe estar entre 0 y 359 grados' })
  rotacion: number;
}

export class ZonaPlanoDto extends FormaEnPlanoDto {
  @IsString()
  @Length(1, LARGO_MAXIMO_ETIQUETA_ZONA, {
    message: `etiqueta debe tener entre 1 y ${LARGO_MAXIMO_ETIQUETA_ZONA} caracteres`,
  })
  @Matches(ETIQUETA_PERMITIDA, {
    message:
      "etiqueta solo admite letras, números, espacios y los signos . , ' ( ) -",
  })
  etiqueta: string;

  @IsNumber()
  @Min(1, { message: 'ancho debe ser mayor a 0' })
  @Max(DIMENSION_MAXIMA_ZONA, {
    message: `ancho no puede superar ${DIMENSION_MAXIMA_ZONA}`,
  })
  ancho: number;

  @IsNumber()
  @Min(1, { message: 'alto debe ser mayor a 0' })
  @Max(DIMENSION_MAXIMA_ZONA, {
    message: `alto no puede superar ${DIMENSION_MAXIMA_ZONA}`,
  })
  alto: number;
}

export class PlanoDto {
  @IsArray()
  @ArrayMaxSize(MAXIMO_ELEMENTOS_PLANO, {
    message: `el plano no puede tener más de ${MAXIMO_ELEMENTOS_PLANO} elementos`,
  })
  @ValidateNested({ each: true })
  @Type(() => ElementoPlanoDto)
  elementos: ElementoPlanoDto[];

  @IsArray()
  @ArrayMaxSize(MAXIMO_ZONAS_PLANO, {
    message: `el plano no puede tener más de ${MAXIMO_ZONAS_PLANO} zonas`,
  })
  @ValidateNested({ each: true })
  @Type(() => ZonaPlanoDto)
  zonas: ZonaPlanoDto[];
}
