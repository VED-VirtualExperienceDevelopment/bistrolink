import {
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
