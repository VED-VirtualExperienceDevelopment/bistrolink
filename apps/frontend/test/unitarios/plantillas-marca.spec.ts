import {
  PLANTILLAS_MARCA,
  canalesRgb,
  plantillaPorCodigo,
  variablesDeMarca,
} from "@/lib/plantillas-marca";

// HU-043 (BL-533): plantillas de marca de la carta.

/** Luminancia relativa de un color #rrggbb (WCAG 2.1). */
function luminancia(hex: string): number {
  const canales = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = canales.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste de un color contra el blanco. */
function contrasteConBlanco(hex: string): number {
  return 1.05 / (luminancia(hex) + 0.05);
}

describe("plantillas de marca", () => {
  it("[TC-U-528] son las cuatro que acepta la API, con la Clásica primero", () => {
    expect(PLANTILLAS_MARCA.map(({ codigo }) => codigo)).toEqual([
      "clasica",
      "gourmet",
      "rapida",
      "familiar",
    ]);
  });

  it.each(PLANTILLAS_MARCA.map((p) => [p.nombre, p] as const))(
    "[TC-U-529] %s: los dos colores tienen contraste AA (4,5:1) con el blanco",
    (_nombre, plantilla) => {
      expect(contrasteConBlanco(plantilla.colorMarca)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrasteConBlanco(plantilla.colorAcento)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it("[TC-U-530] una plantilla que no viene o no se conoce usa la Clásica", () => {
    expect(plantillaPorCodigo("gourmet").nombre).toBe("Gourmet");
    expect(plantillaPorCodigo(undefined).codigo).toBe("clasica");
    expect(plantillaPorCodigo(null).codigo).toBe("clasica");
    expect(plantillaPorCodigo("neon").codigo).toBe("clasica");
  });
});

describe("HU-043 (BL-534): variables de la marca en el menú", () => {
  it("[TC-U-531] pasa un color #rrggbb a los canales RGB de las variables CSS", () => {
    expect(canalesRgb("#6e54ad")).toBe("110 84 173");
    expect(canalesRgb("#b3261e")).toBe("179 38 30");
  });

  it("[TC-U-532] con la Clásica o sin plantilla no define nada: el menú queda como siempre", () => {
    expect(variablesDeMarca("clasica")).toEqual({});
    expect(variablesDeMarca(undefined)).toEqual({});
    expect(variablesDeMarca("neon")).toEqual({});
  });

  it("[TC-U-533] con otra plantilla define el principal, el hover y el acento", () => {
    expect(variablesDeMarca("gourmet")).toEqual({
      "--brand-primary": "92 26 43",
      "--brand-primary-hover": "70 19 31",
      "--brand-accent": "122 90 0",
    });
  });

  it("[TC-U-534] el valor por defecto de globals.css es el de la Clásica", () => {
    const clasica = plantillaPorCodigo("clasica");
    expect(canalesRgb(clasica.colorMarca)).toBe("110 84 173");
    expect(canalesRgb(clasica.colorHover)).toBe("91 70 143");
    expect(canalesRgb(clasica.colorAcento)).toBe("117 91 0");
  });
});
