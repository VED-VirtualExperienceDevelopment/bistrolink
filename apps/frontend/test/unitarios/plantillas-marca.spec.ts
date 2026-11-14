import { PLANTILLAS_MARCA, plantillaPorCodigo } from "@/lib/plantillas-marca";

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
