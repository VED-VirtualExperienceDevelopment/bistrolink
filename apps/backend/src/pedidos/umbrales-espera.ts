/**
 * HU-038 (BL-506): umbrales de espera de las comandas del KDS.
 *
 * Desde cuántos minutos una comanda pasa a «Atención», «Demorado» y «Demora
 * alta». Cada local los configura en Configuración › Cocina; si no los
 * cambia, valen los de por defecto (30/60/120, los mismos que el default de
 * las columnas de la migración 20261110120000_kds_umbrales_espera).
 *
 * El frontend tiene los mismos valores por defecto en
 * apps/frontend/src/components/kds/espera-kds.utils.ts.
 */

export interface UmbralesEspera {
  atencion: number;
  demorado: number;
  demoraAlta: number;
}

export const UMBRALES_ESPERA_POR_DEFECTO: Readonly<UmbralesEspera> = {
  atencion: 30,
  demorado: 60,
  demoraAlta: 120,
};

/**
 * Rango de cada umbral, en minutos. Los mismos que los CHECK de la
 * migración. 600 min = 10 h: alcanza para cualquier turno.
 */
export const MINUTOS_ESPERA_MINIMO = 1;
export const MINUTOS_ESPERA_MAXIMO = 600;

/** Columnas de restaurante con los umbrales (select de Prisma). */
export const SELECT_UMBRALES_ESPERA = {
  minutosEsperaAtencion: true,
  minutosEsperaDemorado: true,
  minutosEsperaDemoraAlta: true,
} as const;

export interface FilaUmbralesEspera {
  minutosEsperaAtencion: number;
  minutosEsperaDemorado: number;
  minutosEsperaDemoraAlta: number;
}

/** Umbrales del restaurante. Sin restaurante (alta incompleta): los de por defecto. */
export function umbralesDelRestaurante(
  fila: FilaUmbralesEspera | null,
): UmbralesEspera {
  if (!fila) return { ...UMBRALES_ESPERA_POR_DEFECTO };
  return {
    atencion: fila.minutosEsperaAtencion,
    demorado: fila.minutosEsperaDemorado,
    demoraAlta: fila.minutosEsperaDemoraAlta,
  };
}

/**
 * Error si los umbrales no van de menor a mayor
 * (Atención < Demorado < Demora alta), o null si están bien.
 */
export function errorOrdenUmbrales(fila: FilaUmbralesEspera): string | null {
  if (fila.minutosEsperaAtencion >= fila.minutosEsperaDemorado) {
    return '«Demorado desde» tiene que ser mayor que «Atención desde»';
  }
  if (fila.minutosEsperaDemorado >= fila.minutosEsperaDemoraAlta) {
    return '«Demora alta desde» tiene que ser mayor que «Demorado desde»';
  }
  return null;
}
