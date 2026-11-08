import {
  CONSULTA_CELULAR,
  scrollParaCentrar,
  ZOOM_INICIAL,
  ZOOM_MINIMO,
  zoomParaAjustarAncho,
} from "@/components/admin/mesas/mapa-mesas.utils";

// Mapa de mesas en el celular: ajuste al ancho y mesa centrada al elegirla
// desde la lista.

describe("zoomParaAjustarAncho", () => {
  it("achica para que el salón entero entre en el celular", () => {
    expect(zoomParaAjustarAncho(360, 600)).toBe(0.6);
  });

  it("redondea hacia abajo para que el borde derecho no quede cortado", () => {
    expect(zoomParaAjustarAncho(358, 600)).toBe(0.59);
  });

  it("no agranda si el salón ya entra", () => {
    expect(zoomParaAjustarAncho(1200, 800)).toBe(ZOOM_INICIAL);
  });

  it("no baja del mínimo de los botones", () => {
    expect(zoomParaAjustarAncho(360, 1600)).toBe(ZOOM_MINIMO);
  });

  it("con medidas inválidas deja el 100 %", () => {
    expect(zoomParaAjustarAncho(0, 800)).toBe(ZOOM_INICIAL);
    expect(zoomParaAjustarAncho(360, 0)).toBe(ZOOM_INICIAL);
  });
});

describe("scrollParaCentrar", () => {
  it("centra la mesa en lo visible, teniendo en cuenta el zoom", () => {
    expect(
      scrollParaCentrar({ x: 600, y: 400 }, 0.5, { ancho: 200, alto: 100 }),
    ).toEqual({ left: 200, top: 150 });
  });

  it("no da un scroll negativo para mesas cerca del borde", () => {
    expect(
      scrollParaCentrar({ x: 40, y: 40 }, 1, { ancho: 360, alto: 300 }),
    ).toEqual({ left: 0, top: 0 });
  });
});

describe("CONSULTA_CELULAR", () => {
  it("corta justo debajo del breakpoint md de Tailwind (768 px)", () => {
    expect(CONSULTA_CELULAR).toBe("(max-width: 767px)");
  });
});
