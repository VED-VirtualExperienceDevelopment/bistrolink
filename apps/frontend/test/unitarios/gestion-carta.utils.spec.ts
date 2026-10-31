import {
  anuncioCancelado,
  anuncioLevantado,
  anuncioSobre,
  anuncioSoltado,
  conCategoriaEn,
  conItemEn,
  moverA,
  conCategoriaMovida,
  conItemMovido,
  moverUnLugar,
  textoPosicion,
  errorNombreItem,
  errorPrecioItem,
  normalizarPrecio,
  conVersionCategoria,
  conVersionItem,
  errorNombreCategoria,
  esConflictoDeEdicion,
  sePuedeEliminarCategoria,
  sePuedeEliminarItem,
  soloArchivados,
  textoArchivados,
  textoFechaArchivo,
  FILTROS_CARTA_INICIALES,
  filtrarCarta,
  hayFiltrosCarta,
  textoResultadoFiltros,
  conDisponibilidad,
  conVisibilidad,
  sinCategoria,
  sinItem,
  textoContadorCarta,
  textoItemsDeCategoria,
  type CategoriaGestion,
  type ItemGestion,
} from "@/components/menu/gestion-carta.utils";

// BL-398 (BL-392): funciones de la pantalla Gestión de Carta.

const item = (id: string, disponible = true): ItemGestion => ({
  id,
  nombre: `Ítem ${id}`,
  precio: "100",
  disponible,
  categoriaId: "c1",
});

const categoria = (
  id: string,
  items: ItemGestion[],
  activo = true,
): CategoriaGestion => ({ id, nombre: `Cat ${id}`, activo, orden: 0, items });

const CARTA = [
  categoria("c1", [item("a"), item("b", false)]),
  categoria("c2", [item("c")], false),
];

describe("Gestión de Carta: cambios en la lista (BL-398)", () => {
  it("[TC-U-230] cambia la disponibilidad solo del ítem indicado", () => {
    const resultado = conDisponibilidad(CARTA, "a", false);
    expect(resultado[0].items[0].disponible).toBe(false);
    expect(resultado[0].items[1]).toBe(CARTA[0].items[1]);
    expect(resultado[1].items[0]).toBe(CARTA[1].items[0]);
  });

  it("[TC-U-230] cambia la visibilidad solo de la categoría indicada", () => {
    const resultado = conVisibilidad(CARTA, "c2", true);
    expect(resultado[1].activo).toBe(true);
    expect(resultado[0]).toBe(CARTA[0]);
  });

  it("[TC-U-231] saca un ítem o una categoría sin tocar el resto", () => {
    expect(sinItem(CARTA, "b")[0].items.map((i) => i.id)).toEqual(["a"]);
    expect(sinCategoria(CARTA, "c1").map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("Gestión de Carta: contadores (BL-398)", () => {
  it("[TC-U-232] cuenta ítems y agotados, en singular o plural", () => {
    expect(textoContadorCarta(CARTA)).toBe("3 ítems · 1 agotado");
    expect(textoContadorCarta([categoria("c1", [item("a")])])).toBe("1 ítem");
    expect(textoContadorCarta([])).toBe("0 ítems");
    expect(
      textoContadorCarta([
        categoria("c1", [item("a", false), item("b", false)]),
      ]),
    ).toBe("2 ítems · 2 agotados");
  });

  it("[TC-U-232] cuenta los ítems de una categoría", () => {
    expect(textoItemsDeCategoria(CARTA[0])).toBe("2 ítems");
    expect(textoItemsDeCategoria(CARTA[1])).toBe("1 ítem");
  });
});

describe("Gestión de Carta: búsqueda y filtros (BL-398)", () => {
  const conDatos = (
    id: string,
    nombre: string,
    disponible = true,
    descripcion?: string,
  ): ItemGestion => ({ ...item(id, disponible), nombre, descripcion });

  const CARTA_FILTROS: CategoriaGestion[] = [
    {
      ...categoria("c1", [
        conDatos("a", "Picada Completa", true, "Para compartir"),
        conDatos("b", "Papas fritas", false),
      ]),
      nombre: "Picadas",
    },
    {
      ...categoria("c2", [conDatos("c", "Flan con dulce de leche")], false),
      nombre: "Postres",
    },
    { ...categoria("c3", []), nombre: "Bebidas" },
  ];

  const filtrar = (cambios: Partial<typeof FILTROS_CARTA_INICIALES>) =>
    filtrarCarta(CARTA_FILTROS, { ...FILTROS_CARTA_INICIALES, ...cambios });

  const nombres = (cats: CategoriaGestion[]) =>
    cats.flatMap((c) => c.items.map((i) => i.nombre));

  it("[TC-U-233] sin filtros devuelve todo, también las categorías vacías", () => {
    expect(hayFiltrosCarta(FILTROS_CARTA_INICIALES)).toBe(false);
    expect(filtrar({}).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("[TC-U-234] busca por nombre o descripción, sin mayúsculas ni tildes", () => {
    // «PICADA» también coincide con la categoría «Picadas» (trae todos sus
    // ítems); para probar solo el nombre del ítem se busca otra palabra.
    expect(nombres(filtrar({ busqueda: "COMPLETA" }))).toEqual([
      "Picada Completa",
    ]);
    expect(nombres(filtrar({ busqueda: "compartir" }))).toEqual([
      "Picada Completa",
    ]);
    expect(nombres(filtrar({ busqueda: "flán" }))).toEqual([
      "Flan con dulce de leche",
    ]);
  });

  it("[TC-U-234] buscar el nombre de una categoría trae todos sus ítems", () => {
    expect(nombres(filtrar({ busqueda: "picadas" }))).toEqual([
      "Picada Completa",
      "Papas fritas",
    ]);
  });

  it("[TC-U-235] filtra disponibles, agotados y los de categorías ocultas", () => {
    expect(nombres(filtrar({ estado: "AGOTADOS" }))).toEqual(["Papas fritas"]);
    expect(nombres(filtrar({ estado: "DISPONIBLES" }))).toEqual([
      "Picada Completa",
      "Flan con dulce de leche",
    ]);
    expect(nombres(filtrar({ estado: "OCULTOS" }))).toEqual([
      "Flan con dulce de leche",
    ]);
  });

  it("[TC-U-236] filtra por categoría y combina con la búsqueda", () => {
    expect(nombres(filtrar({ categoriaId: "c1" }))).toEqual([
      "Picada Completa",
      "Papas fritas",
    ]);
    expect(nombres(filtrar({ categoriaId: "c1", busqueda: "flan" }))).toEqual(
      [],
    );
  });

  it("[TC-U-237] el resultado se cuenta sobre el total", () => {
    expect(
      textoResultadoFiltros(filtrar({ estado: "AGOTADOS" }), CARTA_FILTROS),
    ).toBe("1 de 3 ítems");
  });
});

describe("Gestión de Carta: archivados (BL-398)", () => {
  const archivado = (id: string, tieneHistorial: boolean): ItemGestion => ({
    ...item(id),
    archivadoEn: "2026-10-31T15:00:00.000Z",
    tieneHistorial,
  });

  const CON_ARCHIVADOS: CategoriaGestion[] = [
    // Activa, con un ítem activo y uno archivado.
    categoria("c1", [item("a"), archivado("b", true)]),
    // Activa, sin nada archivado: no aparece.
    categoria("c2", [item("c")]),
    // Archivada y vacía.
    { ...categoria("c3", []), archivadaEn: "2026-10-30T15:00:00.000Z" },
  ];

  it("[TC-U-238] deja solo lo archivado: ítems archivados y categorías archivadas", () => {
    const resultado = soloArchivados(CON_ARCHIVADOS);
    expect(resultado.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(resultado[0].items.map((i) => i.id)).toEqual(["b"]);
  });

  it("[TC-U-239] cuenta lo archivado", () => {
    expect(textoArchivados(soloArchivados(CON_ARCHIVADOS))).toBe(
      "1 ítem y 1 categoría archivados",
    );
    expect(textoArchivados([categoria("c1", [archivado("b", false)])])).toBe(
      "1 ítem archivado",
    );
    expect(textoArchivados([])).toBe("Nada archivado");
  });

  it("[TC-U-240] solo se ofrece eliminar lo que no tiene historial", () => {
    expect(sePuedeEliminarItem(archivado("b", true))).toBe(false);
    expect(sePuedeEliminarItem(archivado("b", false))).toBe(true);
    // Sin el dato (respuesta vieja), no se ofrece.
    expect(sePuedeEliminarItem(item("a"))).toBe(false);
    expect(sePuedeEliminarCategoria(CON_ARCHIVADOS[2])).toBe(true);
    expect(sePuedeEliminarCategoria(CON_ARCHIVADOS[0])).toBe(false);
  });

  it("[TC-U-241] la fecha de archivo, en hora de Uruguay", () => {
    expect(textoFechaArchivo("2026-10-31T15:00:00.000Z", "o")).toBe(
      "Archivado el 31/10/2026",
    );
    // 01:00 UTC del 1/11 todavía es 31/10 en Uruguay (UTC-3).
    expect(textoFechaArchivo("2026-11-01T01:00:00.000Z", "a")).toBe(
      "Archivada el 31/10/2026",
    );
    expect(textoFechaArchivo(null, "o")).toBeNull();
  });
});

describe("Gestión de Carta: formularios (BL-398)", () => {
  it("[TC-U-242] valida el nombre de la categoría como el backend", () => {
    expect(errorNombreCategoria("  ")).toBe(
      "Ingresá el nombre de la categoría.",
    );
    expect(errorNombreCategoria("a".repeat(61))).toBe(
      "Tiene que tener 60 caracteres como máximo.",
    );
    expect(errorNombreCategoria(" Postres ")).toBeNull();
  });

  it("[TC-U-243] distingue el conflicto de edición del nombre repetido", () => {
    const conEstado = (status: number, mensaje: string) =>
      Object.assign(new Error(mensaje), { status });
    expect(
      esConflictoDeEdicion(
        conEstado(
          409,
          "Otra persona modificó este dato. Recargá para ver los cambios.",
        ),
      ),
    ).toBe(true);
    expect(
      esConflictoDeEdicion(
        conEstado(409, "Ya existe una categoría con ese nombre"),
      ),
    ).toBe(false);
    expect(esConflictoDeEdicion(conEstado(400, "Otra persona modificó"))).toBe(
      false,
    );
    expect(esConflictoDeEdicion("texto")).toBe(false);
  });

  it("[TC-U-244] guarda la versión nueva después de un cambio propio", () => {
    const v = "2026-10-31T15:00:00.000Z";
    expect(conVersionCategoria(CARTA, "c1", v)[0].updatedAt).toBe(v);
    expect(conVersionItem(CARTA, "a", v)[0].items[0].updatedAt).toBe(v);
    // Sin versión en la respuesta, no cambia nada.
    expect(conVersionItem(CARTA, "a", undefined)[0].items[0]).toBe(
      CARTA[0].items[0],
    );
  });
});

describe("Gestión de Carta: formulario de ítem (BL-398)", () => {
  it("[TC-U-245] el nombre del ítem es obligatorio", () => {
    expect(errorNombreItem("   ")).toBe("Ingresá el nombre del ítem.");
    expect(errorNombreItem("Flan")).toBeNull();
  });

  it("[TC-U-246] el precio acepta coma o punto y hasta 2 decimales", () => {
    expect(normalizarPrecio(" 590,50 ")).toBe("590.50");
    expect(errorPrecioItem("590")).toBeNull();
    expect(errorPrecioItem("590,5")).toBeNull();
    expect(errorPrecioItem("0")).toBeNull();
    expect(errorPrecioItem("")).toBe("Ingresá el precio.");
    for (const invalido of ["-10", "590,555", "abc", "05", "1e3"]) {
      expect(errorPrecioItem(invalido)).toBe(
        "Usá solo números, con hasta 2 decimales (por ejemplo, 590 o 590,50).",
      );
    }
  });
});

describe("Gestión de Carta: ordenar con Subir y Bajar (BL-399)", () => {
  const lista = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("[TC-U-254] mueve un lugar hacia arriba o hacia abajo", () => {
    expect(moverUnLugar(lista, "b", -1)?.map((x) => x.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moverUnLugar(lista, "b", 1)?.map((x) => x.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    // No cambia la lista original.
    expect(lista.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("[TC-U-254] en el borde o con un id que no está, no hay nada que mover", () => {
    expect(moverUnLugar(lista, "a", -1)).toBeNull();
    expect(moverUnLugar(lista, "c", 1)).toBeNull();
    expect(moverUnLugar(lista, "x", 1)).toBeNull();
  });

  it("[TC-U-255] mueve una categoría y renumera el orden desde 1", () => {
    const resultado = conCategoriaMovida(CARTA, "c2", -1);
    expect(resultado?.map((c) => [c.id, c.orden])).toEqual([
      ["c2", 1],
      ["c1", 2],
    ]);
    expect(conCategoriaMovida(CARTA, "c1", -1)).toBeNull();
  });

  it("[TC-U-256] mueve un ítem solo dentro de su categoría", () => {
    const resultado = conItemMovido(CARTA, "c1", "b", -1);
    expect(resultado?.[0].items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(resultado?.[1]).toBe(CARTA[1]);
    expect(conItemMovido(CARTA, "c1", "a", -1)).toBeNull();
    expect(conItemMovido(CARTA, "zz", "a", 1)).toBeNull();
  });

  it("[TC-U-257] anuncia la posición nueva", () => {
    expect(textoPosicion("Postres", 2, 5)).toBe(
      "«Postres» quedó en la posición 2 de 5",
    );
  });
});

describe("Gestión de Carta: arrastrar para ordenar (BL-399)", () => {
  const lista = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("[TC-U-258] lleva un elemento al lugar de otro y corre los del medio", () => {
    expect(moverA(lista, "a", "c")?.map((x) => x.id)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(moverA(lista, "d", "b")?.map((x) => x.id)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
    expect(lista.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("[TC-U-258] soltar en el mismo lugar o con ids que no están no cambia nada", () => {
    expect(moverA(lista, "b", "b")).toBeNull();
    expect(moverA(lista, "x", "b")).toBeNull();
    expect(moverA(lista, "a", "x")).toBeNull();
  });

  it("[TC-U-259] arrastra una categoría y renumera; un ítem, solo en su categoría", () => {
    expect(
      conCategoriaEn(CARTA, "c1", "c2")?.map((c) => [c.id, c.orden]),
    ).toEqual([
      ["c2", 1],
      ["c1", 2],
    ]);
    const conItem = conItemEn(CARTA, "c1", "a", "b");
    expect(conItem?.[0].items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(conItem?.[1]).toBe(CARTA[1]);
    expect(conItemEn(CARTA, "zz", "a", "b")).toBeNull();
    expect(conItemEn(CARTA, "c1", "a", "a")).toBeNull();
  });

  it("[TC-U-260] avisa en español qué pasa mientras se arrastra", () => {
    expect(anuncioLevantado("Flan", 2, 4)).toBe(
      "Levantaste «Flan», en la posición 2 de 4.",
    );
    expect(anuncioSobre("Flan", 3, 4)).toBe(
      "«Flan» está sobre la posición 3 de 4.",
    );
    expect(anuncioSoltado("Flan", 3, 4)).toBe(
      "Soltaste «Flan» en la posición 3 de 4.",
    );
    expect(anuncioCancelado("Flan")).toBe(
      "Cancelaste. «Flan» volvió a su lugar.",
    );
  });
});
