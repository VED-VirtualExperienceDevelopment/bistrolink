import {
  acotarRecuadroZona,
  anchoNecesarioZonas,
  DIMENSION_MAXIMA_ZONA,
  DIMENSION_MINIMA_ZONA,
  dimensionesZonaTrasTransformar,
  errorEtiquetaZona,
  LARGO_MAXIMO_ETIQUETA_ZONA,
  MAXIMO_ZONAS_PLANO,
  nuevaZona,
  puedeAgregarZona,
  semiExtensionZona,
  siguienteEtiquetaZona,
} from "@/components/admin/mesas/plano.utils";
import type { ZonaPlano } from "@/types/plano";

/** HU-028 (BL-173): zonas del plano del salón. */

const LIENZO = { ancho: 800, alto: 600 };

function zona(parcial: Partial<ZonaPlano> = {}): ZonaPlano {
  return {
    id: "z1",
    etiqueta: "Patio",
    x: 200,
    y: 150,
    ancho: 300,
    alto: 200,
    ...parcial,
  };
}

describe("siguienteEtiquetaZona", () => {
  it("la primera zona se llama Zona 1", () => {
    expect(siguienteEtiquetaZona([])).toBe("Zona 1");
  });

  it("usa el primer número libre, sin importar mayúsculas", () => {
    expect(
      siguienteEtiquetaZona([{ etiqueta: "zona 1" }, { etiqueta: "Zona 3" }]),
    ).toBe("Zona 2");
  });

  it("no cuenta las zonas con otro nombre", () => {
    expect(siguienteEtiquetaZona([{ etiqueta: "Patio" }])).toBe("Zona 1");
  });
});

describe("nuevaZona", () => {
  it("crea una zona con nombre, id y tamaño por defecto, dentro del lienzo", () => {
    const z = nuevaZona("abc", [], LIENZO);
    expect(z).toMatchObject({ id: "abc", etiqueta: "Zona 1" });
    expect(z.x - z.ancho / 2).toBeGreaterThanOrEqual(0);
    expect(z.y - z.alto / 2).toBeGreaterThanOrEqual(0);
    expect(z.x + z.ancho / 2).toBeLessThanOrEqual(LIENZO.ancho);
    expect(z.y + z.alto / 2).toBeLessThanOrEqual(LIENZO.alto);
  });

  it("corre cada zona nueva para que no quede encima de la anterior", () => {
    const primera = nuevaZona("a", [], LIENZO);
    const segunda = nuevaZona("b", [primera], LIENZO);
    expect(segunda.x).not.toBe(primera.x);
    expect(segunda.etiqueta).toBe("Zona 2");
  });

  it("en un lienzo chico, la zona se achica para entrar", () => {
    const z = nuevaZona("a", [], { ancho: 200, alto: 100 });
    expect(z.ancho).toBeLessThanOrEqual(200);
    expect(z.alto).toBeLessThanOrEqual(100);
  });
});

describe("puedeAgregarZona", () => {
  it("permite agregar hasta el máximo del backend", () => {
    const zonas = Array.from({ length: MAXIMO_ZONAS_PLANO - 1 }, () => zona());
    expect(puedeAgregarZona(zonas)).toBe(true);
    expect(puedeAgregarZona([...zonas, zona()])).toBe(false);
  });
});

describe("errorEtiquetaZona", () => {
  it.each(["Patio", "Salón", "Calle (vereda)", "D'Angelo", "Terraza-norte 2"])(
    'acepta "%s"',
    (etiqueta) => {
      expect(errorEtiquetaZona(etiqueta)).toBeNull();
    },
  );

  it.each([
    ["vacía", ""],
    ["solo espacios", "   "],
    ["con HTML", "<b>Patio</b>"],
    ["con emoji", "Patio 🌿"],
    ["demasiado larga", "a".repeat(LARGO_MAXIMO_ETIQUETA_ZONA + 1)],
  ])("rechaza una etiqueta %s", (_caso, etiqueta) => {
    expect(errorEtiquetaZona(etiqueta)).not.toBeNull();
  });

  it("ignora los espacios de los extremos al medir el largo", () => {
    const justa = "a".repeat(LARGO_MAXIMO_ETIQUETA_ZONA);
    expect(errorEtiquetaZona(`  ${justa}  `)).toBeNull();
  });
});

describe("semiExtensionZona", () => {
  it("es la mitad del ancho y del alto", () => {
    expect(semiExtensionZona({ ancho: 300, alto: 200 })).toEqual({
      dx: 150,
      dy: 100,
    });
  });
});

describe("acotarRecuadroZona", () => {
  const anterior = { x: 100, y: 100, width: 300, height: 200, rotation: 0 };

  it("deja pasar un recuadro que entra en el lienzo", () => {
    const nuevo = { ...anterior, width: 400 };
    expect(acotarRecuadroZona(anterior, nuevo, 1, LIENZO)).toEqual(nuevo);
  });

  it("recorta el borde que se pasa del lienzo y deja crecer el otro", () => {
    const nuevo = { ...anterior, width: 900, height: 250 };
    expect(acotarRecuadroZona(anterior, nuevo, 1, LIENZO)).toEqual({
      ...nuevo,
      width: 700, // 800 - 100
    });
  });

  it("recorta también por arriba y por la izquierda", () => {
    const nuevo = { ...anterior, x: -50, y: -20, width: 450, height: 320 };
    expect(acotarRecuadroZona(anterior, nuevo, 1, LIENZO)).toEqual({
      ...nuevo,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("mantiene el recuadro anterior si queda más chico que el mínimo", () => {
    const nuevo = { ...anterior, width: DIMENSION_MINIMA_ZONA - 1 };
    expect(acotarRecuadroZona(anterior, nuevo, 1, LIENZO)).toBe(anterior);
  });

  it("con zoom 2 compara en píxeles de pantalla", () => {
    // Lienzo de 800 → 1600 px en pantalla.
    const nuevo = { ...anterior, width: 1400 };
    expect(acotarRecuadroZona(anterior, nuevo, 2, LIENZO).width).toBe(1400);
    const pasado = { ...anterior, width: 2000 };
    expect(acotarRecuadroZona(anterior, pasado, 2, LIENZO).width).toBe(1500);
  });

  it("con zoom 2, el mínimo también se duplica en pantalla", () => {
    const nuevo = { ...anterior, width: DIMENSION_MINIMA_ZONA * 2 - 1 };
    expect(acotarRecuadroZona(anterior, nuevo, 2, LIENZO)).toBe(anterior);
  });
});

describe("dimensionesZonaTrasTransformar", () => {
  it("multiplica por la escala de Konva", () => {
    expect(dimensionesZonaTrasTransformar(300, 200, 1.5, 0.5)).toEqual({
      ancho: 450,
      alto: 100,
    });
  });

  it("no baja del mínimo ni pasa del máximo del backend", () => {
    expect(dimensionesZonaTrasTransformar(100, 100, 0.1, 100)).toEqual({
      ancho: DIMENSION_MINIMA_ZONA,
      alto: DIMENSION_MAXIMA_ZONA,
    });
  });
});

describe("anchoNecesarioZonas", () => {
  it("es 0 sin zonas", () => {
    expect(anchoNecesarioZonas([])).toBe(0);
  });

  it("llega hasta el borde derecho de la zona más alejada", () => {
    expect(
      anchoNecesarioZonas([zona({ x: 200 }), zona({ x: 1000, ancho: 400 })]),
    ).toBe(1200);
  });
});
