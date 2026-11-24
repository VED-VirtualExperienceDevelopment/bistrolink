import {
  acumularSinStock,
  anuncioAlerta,
  leerUnidades,
  sinStockVigentes,
  textoSinStock,
  textoUnidades,
  type AlertaStock,
} from "@/components/admin/stock/stock.utils";

// HU-015 (BL-120): alertas de stock del administrador (BL-470: en la campana de Alertas).

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
