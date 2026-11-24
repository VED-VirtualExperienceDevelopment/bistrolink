import {
  UMBRALES_ESPERA_POR_DEFECTO,
  errorOrdenUmbrales,
  umbralesDelRestaurante,
} from '../../src/pedidos/umbrales-espera';

// HU-038 (BL-506): umbrales de espera de las comandas del KDS.

describe('umbralesDelRestaurante', () => {
  it('[TC-U-467] traduce las columnas del restaurante; sin restaurante, los de por defecto (30/60/120)', () => {
    expect(
      umbralesDelRestaurante({
        minutosEsperaAtencion: 20,
        minutosEsperaDemorado: 40,
        minutosEsperaDemoraAlta: 90,
      }),
    ).toEqual({ atencion: 20, demorado: 40, demoraAlta: 90 });

    expect(umbralesDelRestaurante(null)).toEqual({
      atencion: 30,
      demorado: 60,
      demoraAlta: 120,
    });
    // Devuelve una copia: quien la reciba no puede cambiar los de por defecto.
    expect(umbralesDelRestaurante(null)).not.toBe(UMBRALES_ESPERA_POR_DEFECTO);
  });
});

describe('errorOrdenUmbrales', () => {
  const fila = (atencion: number, demorado: number, demoraAlta: number) => ({
    minutosEsperaAtencion: atencion,
    minutosEsperaDemorado: demorado,
    minutosEsperaDemoraAlta: demoraAlta,
  });

  it('[TC-U-468] exige Atención < Demorado < Demora alta', () => {
    expect(errorOrdenUmbrales(fila(30, 60, 120))).toBeNull();
    expect(errorOrdenUmbrales(fila(1, 2, 3))).toBeNull();
    expect(errorOrdenUmbrales(fila(60, 60, 120))).toBe(
      '«Demorado desde» tiene que ser mayor que «Atención desde»',
    );
    expect(errorOrdenUmbrales(fila(70, 60, 120))).toBe(
      '«Demorado desde» tiene que ser mayor que «Atención desde»',
    );
    expect(errorOrdenUmbrales(fila(30, 120, 120))).toBe(
      '«Demora alta desde» tiene que ser mayor que «Demorado desde»',
    );
    expect(errorOrdenUmbrales(fila(30, 60, 50))).toBe(
      '«Demora alta desde» tiene que ser mayor que «Demorado desde»',
    );
  });
});
