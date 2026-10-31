import {
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
