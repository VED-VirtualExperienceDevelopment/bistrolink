import { IsIn, IsNumber, Max, Min } from 'class-validator';

export const FORMAS_MESA_VALIDAS = [
  'CIRCULO',
  'CUADRADO',
  'RECTANGULO',
] as const;
export type FormaMesa = (typeof FORMAS_MESA_VALIDAS)[number];

export class MesaLayoutDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsIn(FORMAS_MESA_VALIDAS, {
    message: `forma debe ser una de: ${FORMAS_MESA_VALIDAS.join(', ')}`,
  })
  forma: FormaMesa;

  @IsNumber()
  @Min(1, { message: 'ancho debe ser mayor a 0' })
  ancho: number;

  @IsNumber()
  @Min(1, { message: 'alto debe ser mayor a 0' })
  alto: number;

  @IsNumber()
  @Min(0)
  @Max(359, { message: 'rotacion debe estar entre 0 y 359 grados' })
  rotacion: number;
}
