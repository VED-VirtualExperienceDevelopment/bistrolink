import { IsIn, IsNumber, Max, Min } from 'class-validator';

export const FORMAS_MESA_VALIDAS = [
  'CIRCULO',
  'CUADRADO',
  'RECTANGULO',
] as const;
export type FormaMesa = (typeof FORMAS_MESA_VALIDAS)[number];

/**
 * BL-58: topes de seguridad para que no se persistan valores absurdos en el
 * JSON de layout. Son holgados a propósito: no reemplazan los límites del
 * editor, solo frenan payloads que no podría generar un uso normal.
 *
 * - x / y son el CENTRO de la mesa (ver MesaShape.tsx). El canvas mide
 *   600 px de alto y el ancho del contenedor (responsive), y el editor no
 *   tiene dragBoundFunc: una mesa arrastrada apenas fuera del borde queda
 *   con coordenadas negativas o mayores al canvas. Por eso se aceptan
 *   negativos y un rango amplio.
 * - ancho / alto: el editor impone un mínimo de 20 px
 *   (DIMENSION_MINIMA_MESA) y no tiene máximo; 1000 px supera el alto del
 *   canvas, así que una mesa real nunca llega.
 */
export const COORDENADA_MAXIMA_MESA = 10_000;
export const DIMENSION_MAXIMA_MESA = 1_000;

export class MesaLayoutDto {
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

  @IsIn(FORMAS_MESA_VALIDAS, {
    message: `forma debe ser una de: ${FORMAS_MESA_VALIDAS.join(', ')}`,
  })
  forma: FormaMesa;

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
