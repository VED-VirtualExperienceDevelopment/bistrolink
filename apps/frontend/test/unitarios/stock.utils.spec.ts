import {
  acumularSinStock,
  anuncioAlerta,
  colorBadge,
  etiquetaCampana,
  leerUnidades,
  siguienteIndice,
  sinStockVigentes,
  textoBadge,
  textoSinStock,
  textoUnidades,
  type AlertaStock,
} from "@/components/admin/stock/stock.utils";

// HU-015 (BL-120): campana de alertas de stock del administrador.

const porAgotarse: AlertaStock = {
  itemId: "a",
  nombre: "Flan",
  stockActual: 3,
  umbralAlerta: 5,
  tipo: "STOCK_CRITICO",
};
const agotado: AlertaStock = {
  itemId: "b",
  nombre: "Milanesa",
  stockActual: 0,
  umbralAlerta: 5,
  tipo: "AGOTADO",
};

describe("stock.utils", () => {
  it("[TC-U-354] el nombre accesible de la campana dice cuántos ítems críticos hay", () => {
    expect(etiquetaCampana([])).toBe(
      "Notificaciones de stock: sin ítems críticos",
    );
    expect(etiquetaCampana([porAgotarse])).toBe(
      "Notificaciones de stock: 1 ítem crítico",
    );
    expect(etiquetaCampana([porAgotarse, agotado])).toBe(
      "Notificaciones de stock: 2 ítems críticos",
    );
  });

  it("[TC-U-355] badge: ámbar si solo hay por agotarse, rojo si hay algún agotado, nada sin alertas; 9+ a partir de 10", () => {
    expect(colorBadge([])).toBeNull();
    expect(colorBadge([porAgotarse])).toBe("ambar");
    expect(colorBadge([porAgotarse, agotado])).toBe("rojo");
    expect(textoBadge(3)).toBe("3");
    expect(textoBadge(12)).toBe("9+");
  });

  it("[TC-U-356] unidades frente al umbral y ventas sin stock", () => {
    expect(textoUnidades(porAgotarse)).toBe("Quedan 3 · aviso en 5");
    expect(textoUnidades(agotado)).toBe("Sin unidades · aviso en 5");
    expect(textoSinStock(1)).toBe("1 vendida sin stock");
    expect(textoSinStock(2)).toBe("2 vendidas sin stock");
  });

  it("[TC-U-357] solo se anuncia lo nuevo o lo que empeoró", () => {
    expect(anuncioAlerta([], porAgotarse)).toBe(
      "Stock: Flan por agotarse, quedan 3",
    );
    expect(
      anuncioAlerta([porAgotarse], { ...porAgotarse, stockActual: 2 }),
    ).toBe("");
    expect(
      anuncioAlerta([{ ...agotado, tipo: "STOCK_CRITICO" }], agotado),
    ).toBe("Stock: Milanesa se agotó");
    expect(anuncioAlerta([agotado], { ...agotado, vendidoSinStock: 1 })).toBe(
      "Stock: Milanesa, 1 vendida sin stock",
    );
  });

  it("[TC-U-358] las ventas sin stock se suman por ítem y se olvidan cuando el ítem sale de las alertas", () => {
    const una = acumularSinStock({}, { ...agotado, vendidoSinStock: 1 });
    const dos = acumularSinStock(una, { ...agotado, vendidoSinStock: 2 });
    expect(dos).toEqual({ b: 3 });
    expect(acumularSinStock(dos, porAgotarse)).toEqual({ b: 3 });
    expect(sinStockVigentes(dos, [agotado])).toEqual({ b: 3 });
    expect(sinStockVigentes(dos, [porAgotarse])).toEqual({});
  });

  it("[TC-U-359] el menú se recorre con flechas (circular), Inicio y Fin", () => {
    expect(siguienteIndice(0, 3, "ArrowDown")).toBe(1);
    expect(siguienteIndice(2, 3, "ArrowDown")).toBe(0);
    expect(siguienteIndice(0, 3, "ArrowUp")).toBe(2);
    expect(siguienteIndice(1, 3, "Home")).toBe(0);
    expect(siguienteIndice(1, 3, "End")).toBe(2);
    expect(siguienteIndice(1, 3, "a")).toBeNull();
    expect(siguienteIndice(0, 0, "ArrowDown")).toBeNull();
  });

  it("[TC-U-360] reponer: un entero de 0 al tope; vacío, decimales, negativos o de más se rechazan", () => {
    expect(leerUnidades(" 12 ")).toEqual({ ok: true, valor: 12 });
    expect(leerUnidades("0")).toEqual({ ok: true, valor: 0 });
    expect(leerUnidades("")).toEqual({
      ok: false,
      error: "Ingresá las unidades.",
    });
    expect(leerUnidades("2,5").ok).toBe(false);
    expect(leerUnidades("-3").ok).toBe(false);
    expect(leerUnidades("100001").ok).toBe(false);
  });
});
