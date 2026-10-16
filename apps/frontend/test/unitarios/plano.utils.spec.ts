import {
  acotarRecuadroZona,
  anchoNecesarioElementos,
  anchoNecesarioZonas,
  DIMENSION_MAXIMA_ELEMENTO,
  DIMENSION_MINIMA_ELEMENTO,
  dimensionesElementoTrasTransformar,
  disposicionElemento,
  girarElemento90,
  MAXIMO_ELEMENTOS_PLANO,
  nuevoElemento,
  puedeAgregarElemento,
  semiExtensionElemento,
  TAMANO_POR_ELEMENTO,
  tamanoElementoPermitido,
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
import { ICONO_POR_ELEMENTO } from "@/components/admin/mesas/plano-iconos";
import {
  TIPOS_ELEMENTO_PLANO,
  type ElementoPlano,
  type ZonaPlano,
} from "@/types/plano";

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

// --- Elementos fijos --------------------------------------------------------------

function elemento(parcial: Partial<ElementoPlano> = {}): ElementoPlano {
  return {
    id: "e1",
    tipo: "BARRA",
    x: 400,
    y: 300,
    ancho: 220,
    alto: 60,
    rotacion: 0,
    ...parcial,
  };
}

describe("ICONO_POR_ELEMENTO y TAMANO_POR_ELEMENTO", () => {
  it("cada tipo tiene nombre, ícono, trazo y tamaño por defecto", () => {
    for (const tipo of TIPOS_ELEMENTO_PLANO) {
      const { etiqueta, icono, trazo } = ICONO_POR_ELEMENTO[tipo];
      expect(etiqueta.length).toBeGreaterThan(0);
      expect(icono).toMatch(/^[a-z_0-9]+$/);
      expect(trazo).toMatch(/^M/);
      const { ancho, alto } = TAMANO_POR_ELEMENTO[tipo];
      expect(Math.min(ancho, alto)).toBeGreaterThanOrEqual(
        DIMENSION_MINIMA_ELEMENTO,
      );
    }
  });
});

describe("nuevoElemento", () => {
  it.each(TIPOS_ELEMENTO_PLANO)(
    "crea un/a %s sin rotar, con su tamaño, dentro del lienzo",
    (tipo) => {
      const e = nuevoElemento("x", tipo, [], LIENZO);
      expect(e).toMatchObject({ id: "x", tipo, rotacion: 0 });
      expect(e.ancho).toBe(TAMANO_POR_ELEMENTO[tipo].ancho);
      expect(e.x - e.ancho / 2).toBeGreaterThanOrEqual(0);
      expect(e.x + e.ancho / 2).toBeLessThanOrEqual(LIENZO.ancho);
      expect(e.y + e.alto / 2).toBeLessThanOrEqual(LIENZO.alto);
    },
  );

  it("corre cada elemento nuevo para que no queden apilados", () => {
    const primero = nuevoElemento("a", "CAJA", [], LIENZO);
    const segundo = nuevoElemento("b", "CAJA", [primero], LIENZO);
    expect(segundo.x).not.toBe(primero.x);
  });
});

describe("puedeAgregarElemento", () => {
  it("permite agregar hasta el máximo del backend", () => {
    const lista = Array.from({ length: MAXIMO_ELEMENTOS_PLANO - 1 }, () =>
      elemento(),
    );
    expect(puedeAgregarElemento(lista)).toBe(true);
    expect(puedeAgregarElemento([...lista, elemento()])).toBe(false);
  });
});

describe("semiExtensionElemento", () => {
  it("sin rotar es la mitad del ancho y del alto", () => {
    expect(semiExtensionElemento(elemento())).toEqual({ dx: 110, dy: 30 });
  });

  it("rotado 90° intercambia ancho y alto", () => {
    const { dx, dy } = semiExtensionElemento(elemento({ rotacion: 90 }));
    expect(dx).toBeCloseTo(30);
    expect(dy).toBeCloseTo(110);
  });
});

describe("girarElemento90", () => {
  it("suma 90° y vuelve a 0 después de 270°", () => {
    expect(girarElemento90(elemento(), LIENZO).rotacion).toBe(90);
    expect(girarElemento90(elemento({ rotacion: 270 }), LIENZO).rotacion).toBe(
      0,
    );
  });

  it("si al girar se sale del lienzo, lo reacomoda", () => {
    // Barra horizontal pegada abajo: girada mide 220 de alto.
    const pegada = elemento({ y: LIENZO.alto - 30 });
    const girada = girarElemento90(pegada, LIENZO);
    expect(girada.y + 110).toBeCloseTo(LIENZO.alto);
  });

  it("si entra, no lo mueve", () => {
    const girada = girarElemento90(elemento(), LIENZO);
    expect({ x: girada.x, y: girada.y }).toEqual({ x: 400, y: 300 });
  });
});

describe("tamanoElementoPermitido", () => {
  it("acepta entre el mínimo y el máximo", () => {
    expect(tamanoElementoPermitido({ width: 70, height: 24 }, 1)).toBe(true);
    expect(
      tamanoElementoPermitido(
        { width: DIMENSION_MINIMA_ELEMENTO - 1, height: 24 },
        1,
      ),
    ).toBe(false);
    expect(
      tamanoElementoPermitido(
        { width: DIMENSION_MAXIMA_ELEMENTO + 1, height: 24 },
        1,
      ),
    ).toBe(false);
  });

  it("con zoom compara en unidades del lienzo", () => {
    // 30 px en pantalla con zoom 2 = 15 en el lienzo: menos que el mínimo.
    expect(tamanoElementoPermitido({ width: 30, height: 60 }, 2)).toBe(false);
  });
});

describe("dimensionesElementoTrasTransformar", () => {
  it("multiplica por la escala y respeta los topes", () => {
    expect(dimensionesElementoTrasTransformar(100, 50, 2, 0.1)).toEqual({
      ancho: 200,
      alto: DIMENSION_MINIMA_ELEMENTO,
    });
    expect(dimensionesElementoTrasTransformar(600, 50, 3, 1).ancho).toBe(
      DIMENSION_MAXIMA_ELEMENTO,
    );
  });
});

describe("anchoNecesarioElementos", () => {
  it("considera la rotación (caja envolvente)", () => {
    expect(anchoNecesarioElementos([elemento({ x: 900 })])).toBe(1010);
    expect(
      anchoNecesarioElementos([elemento({ x: 900, rotacion: 90 })]),
    ).toBeCloseTo(930);
  });
});

describe("disposicionElemento", () => {
  it("con lugar de alto, el nombre va debajo del ícono", () => {
    const d = disposicionElemento({ ancho: 80, alto: 80, rotacion: 0 }, "Baño");
    expect(d.etiqueta?.alineacion).toBe("center");
    expect(d.etiqueta!.y).toBeGreaterThan(d.icono.y);
  });

  it("en un elemento bajo y ancho, el nombre va a la derecha", () => {
    const d = disposicionElemento(
      { ancho: 220, alto: 40, rotacion: 0 },
      "Barra",
    );
    expect(d.etiqueta?.alineacion).toBe("left");
    expect(d.etiqueta!.x).toBeGreaterThan(d.icono.x);
  });

  it("si no entra el nombre, muestra solo el ícono", () => {
    const d = disposicionElemento(
      { ancho: 40, alto: 24, rotacion: 0 },
      "Puerta",
    );
    expect(d.etiqueta).toBeNull();
  });

  it("calcula sobre lo que ocupa en pantalla: rotado 90° usa el alto como ancho", () => {
    const horizontal = disposicionElemento(
      { ancho: 220, alto: 50, rotacion: 0 },
      "Barra",
    );
    const vertical = disposicionElemento(
      { ancho: 220, alto: 50, rotacion: 90 },
      "Barra",
    );
    expect(horizontal.etiqueta?.alineacion).toBe("left");
    expect(vertical.etiqueta?.alineacion).toBe("center");
  });

  it("el ícono queda dentro del elemento y entre 12 y 32 px", () => {
    for (const tipo of TIPOS_ELEMENTO_PLANO) {
      const { ancho, alto } = TAMANO_POR_ELEMENTO[tipo];
      const { icono } = disposicionElemento(
        { ancho, alto, rotacion: 0 },
        ICONO_POR_ELEMENTO[tipo].etiqueta,
      );
      expect(icono.tamano).toBeGreaterThanOrEqual(12);
      expect(icono.tamano).toBeLessThanOrEqual(32);
      expect(icono.x).toBeGreaterThanOrEqual(-ancho / 2);
      expect(icono.x + icono.tamano).toBeLessThanOrEqual(ancho / 2);
      expect(icono.y).toBeGreaterThanOrEqual(-alto / 2);
      expect(icono.y + icono.tamano).toBeLessThanOrEqual(alto / 2);
    }
  });
});
