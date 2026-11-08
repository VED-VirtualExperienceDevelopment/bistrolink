import {
  distanciaEntrePuntos,
  siguienteZoom,
  ZOOM_MAXIMO,
  ZOOM_MINIMO,
  zoomPorPellizco,
} from "@/components/admin/mesas/mapa-mesas.utils";

// Zoom con dos dedos en el mapa de mesas (móvil y tablet).

describe("distanciaEntrePuntos", () => {
  it("mide la distancia entre dos dedos", () => {
    expect(
      distanciaEntrePuntos(
        { clientX: 0, clientY: 0 },
        { clientX: 30, clientY: 40 },
      ),
    ).toBe(50);
  });
});

describe("zoomPorPellizco", () => {
  it("duplica el zoom si los dedos se separan el doble", () => {
    expect(zoomPorPellizco(1, 100, 200)).toBe(2);
  });

  it("reduce el zoom si los dedos se juntan", () => {
    expect(zoomPorPellizco(1, 200, 150)).toBe(0.75);
  });

  it("no pasa del máximo ni del mínimo de los botones", () => {
    expect(zoomPorPellizco(1.5, 100, 400)).toBe(ZOOM_MAXIMO);
    expect(zoomPorPellizco(0.75, 100, 10)).toBe(ZOOM_MINIMO);
  });

  it("redondea a centésimas para que el porcentaje no salte", () => {
    expect(zoomPorPellizco(1, 300, 400)).toBe(1.33);
  });

  it("con distancia inicial 0 deja el zoom como estaba", () => {
    expect(zoomPorPellizco(1.25, 0, 150)).toBe(1.25);
  });

  it("después de un pellizco, los botones siguen al nivel más cercano", () => {
    const despuesDelPellizco = zoomPorPellizco(1, 300, 400); // 1.33
    expect(siguienteZoom(despuesDelPellizco, 1)).toBe(1.5);
    expect(siguienteZoom(despuesDelPellizco, -1)).toBe(1.25);
  });
});
