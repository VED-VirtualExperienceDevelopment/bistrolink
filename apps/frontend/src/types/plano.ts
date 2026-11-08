/**
 * HU-028 (BL-173): plano completo del salón (elementos fijos y zonas). Mismo
 * contrato que PlanoDto del backend (apps/backend/src/mesas/dto/plano.dto.ts):
 * x / y son el CENTRO de cada forma, en unidades del lienzo (zoom 1).
 */

export const TIPOS_ELEMENTO_PLANO = [
  "PUERTA",
  "BANO",
  "COCINA",
  "CAJA",
  "BARRA",
] as const;
export type TipoElementoPlano = (typeof TIPOS_ELEMENTO_PLANO)[number];

export interface ElementoPlano {
  id: string;
  tipo: TipoElementoPlano;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  rotacion: number;
}

export interface ZonaPlano {
  id: string;
  etiqueta: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface PlanoSalon {
  elementos: ElementoPlano[];
  zonas: ZonaPlano[];
}
