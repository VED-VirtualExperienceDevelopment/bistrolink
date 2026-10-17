import {
  accionDeTecla,
  aPlanoPayload,
  acotarRecuadroZona,
  anchoNecesarioElementos,
  anchoNecesarioZonas,
  DIMENSION_MAXIMA_ELEMENTO,
  DIMENSION_MINIMA_ELEMENTO,
  dimensionesElementoTrasTransformar,
  disposicionElemento,
  girarElemento90,
  MAXIMO_ELEMENTOS_PLANO,
  normalizarPlano,
  nuevoElemento,
  PLANO_VACIO,
  zonaDePunto,
  puedeAgregarElemento,
  semiExtensionElemento,
  TAMANO_POR_ELEMENTO,
  tamanoElementoPermitido,
  DIMENSION_MAXIMA_ZONA,
  DIMENSION_MINIMA_ZONA,
  dimensionesZonaTrasTransformar,
  errorEtiquetaZona,
  esCampoDeTexto,
  fotoParaGuardar,
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

// --- Guardar y cargar -------------------------------------------------------------

describe("normalizarPlano (respuesta de GET /mesas/plano)", () => {
  it("deja pasar un plano válido tal cual", () => {
    const plano = { elementos: [elemento()], zonas: [zona()] };
    expect(normalizarPlano(plano)).toEqual(plano);
  });

  it.each([null, undefined, "texto", 42, []])(
    "con una respuesta sin forma de plano (%p) devuelve un plano vacío",
    (datos) => {
      expect(normalizarPlano(datos)).toEqual(PLANO_VACIO);
    },
  );

  it("si falta una de las listas, la toma como vacía", () => {
    expect(normalizarPlano({ zonas: [zona()] })).toEqual({
      elementos: [],
      zonas: [zona()],
    });
  });

  it("descarta elementos con un tipo desconocido o números inválidos", () => {
    const plano = normalizarPlano({
      elementos: [
        elemento({ id: "ok" }),
        { ...elemento({ id: "tipo" }), tipo: "ASCENSOR" },
        { ...elemento({ id: "nan" }), x: Number.NaN },
        { ...elemento({ id: "texto" }), ancho: "80" },
        null,
      ],
      zonas: [],
    });
    expect(plano.elementos.map((e) => e.id)).toEqual(["ok"]);
  });

  it("descarta zonas sin etiqueta", () => {
    const sinEtiqueta: Partial<ZonaPlano> = zona({ id: "z2" });
    delete sinEtiqueta.etiqueta;
    const plano = normalizarPlano({
      elementos: [],
      zonas: [zona(), sinEtiqueta],
    });
    expect(plano.zonas.map((z) => z.id)).toEqual(["z1"]);
  });

  it("no copia propiedades de más", () => {
    const plano = normalizarPlano({
      elementos: [{ ...elemento(), color: "rojo" }],
      zonas: [{ ...zona(), mesas: [1] }],
    });
    expect(Object.keys(plano.elementos[0]).sort()).toEqual([
      "alto",
      "ancho",
      "id",
      "rotacion",
      "tipo",
      "x",
      "y",
    ]);
    expect(Object.keys(plano.zonas[0]).sort()).toEqual([
      "alto",
      "ancho",
      "etiqueta",
      "id",
      "x",
      "y",
    ]);
  });
});

describe("aPlanoPayload (plano del POST /mesas/layout)", () => {
  it("manda solo los campos que acepta el backend (forbidNonWhitelisted)", () => {
    const conExtras = {
      ...elemento(),
      seleccionado: true,
    } as unknown as ElementoPlano;
    const payload = aPlanoPayload([zona()], [conExtras]);
    expect(Object.keys(payload.elementos[0]).sort()).toEqual([
      "alto",
      "ancho",
      "id",
      "rotacion",
      "tipo",
      "x",
      "y",
    ]);
    expect(Object.keys(payload.zonas[0]).sort()).toEqual([
      "alto",
      "ancho",
      "etiqueta",
      "id",
      "x",
      "y",
    ]);
  });

  it("sobrevive la ida y vuelta: lo que se guarda es lo que se carga", () => {
    const payload = aPlanoPayload([zona()], [elemento()]);
    const recibido = normalizarPlano(JSON.parse(JSON.stringify(payload)));
    expect(recibido).toEqual(payload);
  });

  it("sin zonas ni elementos manda listas vacías (vacía el plano guardado)", () => {
    expect(aPlanoPayload([], [])).toEqual(PLANO_VACIO);
  });
});

// --- Accesibilidad y UX (paso 6) --------------------------------------------------

describe("zonaDePunto (lista alternativa del plano)", () => {
  const patio = zona({ id: "p", etiqueta: "Patio", x: 200, y: 150 }); // 50-350 x 50-250

  it("devuelve la zona que contiene el punto", () => {
    expect(zonaDePunto({ x: 100, y: 100 }, [patio])).toBe("Patio");
  });

  it("cuenta el borde como adentro", () => {
    expect(zonaDePunto({ x: 350, y: 250 }, [patio])).toBe("Patio");
  });

  it("devuelve null si el punto no cae en ninguna zona", () => {
    expect(zonaDePunto({ x: 400, y: 100 }, [patio])).toBeNull();
    expect(zonaDePunto({ x: 100, y: 100 }, [])).toBeNull();
  });

  it("si dos zonas se superponen, gana la que se dibuja arriba (la última)", () => {
    const barra = zona({ id: "b", etiqueta: "Barra", x: 250, y: 150 });
    expect(zonaDePunto({ x: 250, y: 150 }, [patio, barra])).toBe("Barra");
  });
});

describe("fotoParaGuardar (cambios sin guardar)", () => {
  it("es igual para el mismo contenido", () => {
    expect(fotoParaGuardar([{ numero: 1 }], [zona()], [elemento()])).toBe(
      fotoParaGuardar([{ numero: 1 }], [zona()], [elemento()]),
    );
  });

  it("cambia si se mueve una zona o un elemento", () => {
    const antes = fotoParaGuardar([], [zona()], [elemento()]);
    expect(fotoParaGuardar([], [zona({ x: 201 })], [elemento()])).not.toBe(
      antes,
    );
    expect(
      fotoParaGuardar([], [zona()], [elemento({ rotacion: 90 })]),
    ).not.toBe(antes);
  });

  it("cambia si cambian las mesas", () => {
    expect(fotoParaGuardar([{ numero: 1 }], [], [])).not.toBe(
      fotoParaGuardar([{ numero: 2 }], [], []),
    );
  });

  it("ignora propiedades que no se guardan (solo usa los campos del POST)", () => {
    const conExtra = { ...zona(), seleccionada: true } as unknown as ZonaPlano;
    expect(fotoParaGuardar([], [conExtra], [])).toBe(
      fotoParaGuardar([], [zona()], []),
    );
  });
});

describe("accionDeTecla (atajos del editor)", () => {
  it.each(["Delete", "Backspace"])("%s elimina lo seleccionado", (tecla) => {
    expect(accionDeTecla(tecla, false)).toBe("eliminar");
  });

  it("Escape deselecciona", () => {
    expect(accionDeTecla("Escape", false)).toBe("deseleccionar");
  });

  it("otras teclas no hacen nada", () => {
    expect(accionDeTecla("a", false)).toBeNull();
    expect(accionDeTecla("Enter", false)).toBeNull();
  });

  it("mientras se escribe en un campo de texto, ningún atajo se activa", () => {
    expect(accionDeTecla("Backspace", true)).toBeNull();
    expect(accionDeTecla("Escape", true)).toBeNull();
  });
});

describe("esCampoDeTexto", () => {
  it.each(["INPUT", "TEXTAREA", "SELECT", "input"])(
    "%s es un campo de texto",
    (tagName) => {
      expect(esCampoDeTexto({ tagName })).toBe(true);
    },
  );

  it("un elemento editable también cuenta", () => {
    expect(esCampoDeTexto({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
  });

  it("un botón, el body o null no son campos de texto", () => {
    expect(esCampoDeTexto({ tagName: "BUTTON" })).toBe(false);
    expect(esCampoDeTexto({ tagName: "BODY" })).toBe(false);
    expect(esCampoDeTexto(null)).toBe(false);
  });
});
