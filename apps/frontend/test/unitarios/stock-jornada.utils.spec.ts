import {
  agruparPorCategoria,
  ajustesParaGuardar,
  erroresDeFila,
  erroresDelFormulario,
  filasConCambios,
  formularioDesde,
  fusionarConServidor,
  primerCampoConError,
  reemplazarItems,
  resumenStock,
  textoGuardado,
  textoPendientes,
  type ItemStock,
} from "@/components/admin/stock/stock-jornada.utils";

// HU-015 (BL-120): pantalla «Stock de la jornada» del administrador.

const POSTRES = { id: "c-postres", nombre: "Postres" };
const PLATOS = { id: "c-platos", nombre: "Platos" };

function item(parcial: Partial<ItemStock> & { id: string }): ItemStock {
  return {
    nombre: parcial.id,
    categoria: PLATOS,
    disponible: true,
    controlaStock: false,
    stockActual: 0,
    umbralAlerta: 5,
    alerta: null,
    ...parcial,
  };
}

const milanesa = item({
  id: "milanesa",
  controlaStock: true,
  stockActual: 10,
  umbralAlerta: 5,
});
const flan = item({
  id: "flan",
  categoria: POSTRES,
  controlaStock: true,
  stockActual: 2,
  umbralAlerta: 3,
  alerta: "STOCK_CRITICO",
});
const ravioles = item({ id: "ravioles" });

describe("stock de la jornada", () => {
  it("[TC-U-361] agrupa por categoría en el orden de la carta y arma el formulario con lo guardado", () => {
    const grupos = agruparPorCategoria([milanesa, flan, ravioles]);
    expect(grupos.map((g) => g.categoria.nombre)).toEqual([
      "Platos",
      "Postres",
    ]);
    expect(grupos[0].items.map((i) => i.id)).toEqual(["milanesa", "ravioles"]);
    expect(agruparPorCategoria([])).toEqual([]);

    expect(formularioDesde([milanesa, ravioles])).toEqual({
      milanesa: { controlaStock: true, stock: "10", umbral: "5" },
      ravioles: { controlaStock: false, stock: "0", umbral: "5" },
    });
  });

  it("[TC-U-362] valida unidades y aviso solo con control de stock", () => {
    expect(
      erroresDeFila({ controlaStock: true, stock: "", umbral: "2.5" }),
    ).toEqual({
      stock: "Ingresá las unidades.",
      umbral: "Usá un número entero, sin decimales.",
    });
    expect(
      erroresDeFila({ controlaStock: true, stock: "3", umbral: "1" }),
    ).toEqual({});
    // Sin control los campos están deshabilitados: no se validan.
    expect(
      erroresDeFila({ controlaStock: false, stock: "", umbral: "x" }),
    ).toEqual({});

    expect(
      erroresDelFormulario({
        a: { controlaStock: true, stock: "-1", umbral: "5" },
        b: { controlaStock: true, stock: "4", umbral: "5" },
      }),
    ).toEqual({ a: { stock: "Usá un número entero, sin decimales." } });
  });

  it("[TC-U-363] el PATCH lleva solo los ítems y los campos que cambiaron", () => {
    const formulario = formularioDesde([milanesa, flan, ravioles]);
    expect(ajustesParaGuardar([milanesa, flan, ravioles], formulario)).toEqual(
      [],
    );

    formulario.milanesa = { controlaStock: true, stock: " 8 ", umbral: "5" };
    formulario.ravioles = { controlaStock: true, stock: "20", umbral: "4" };
    formulario.flan = { controlaStock: false, stock: "99", umbral: "3" };
    expect(ajustesParaGuardar([milanesa, flan, ravioles], formulario)).toEqual([
      { itemId: "milanesa", stockActual: 8 },
      { itemId: "flan", controlaStock: false },
      {
        itemId: "ravioles",
        controlaStock: true,
        stockActual: 20,
        umbralAlerta: 4,
      },
    ]);
  });

  it("[TC-U-364] una fila con error no se manda, pero cuenta como cambio para poder ver el error", () => {
    const formulario = formularioDesde([milanesa, ravioles]);
    formulario.milanesa = { controlaStock: true, stock: "", umbral: "5" };
    expect(ajustesParaGuardar([milanesa, ravioles], formulario)).toEqual([]);
    expect(filasConCambios([milanesa, ravioles], formulario)).toBe(1);

    // Sin control, las unidades no cuentan; el cambio de control sí.
    formulario.milanesa = { controlaStock: true, stock: "10", umbral: "5" };
    formulario.ravioles = { controlaStock: false, stock: "7", umbral: "5" };
    expect(filasConCambios([milanesa, ravioles], formulario)).toBe(0);
    formulario.ravioles = { controlaStock: true, stock: "0", umbral: "5" };
    expect(filasConCambios([milanesa, ravioles], formulario)).toBe(1);
    expect(filasConCambios([milanesa], {})).toBe(0);
  });

  it("[TC-U-365] el foco va al primer campo con error, en el orden de la pantalla", () => {
    const errores = {
      flan: { umbral: "Ingresá las unidades." },
      ravioles: { stock: "Ingresá las unidades." },
    };
    expect(primerCampoConError([milanesa, flan, ravioles], errores)).toBe(
      "umbral-flan",
    );
    expect(primerCampoConError([ravioles, flan], errores)).toBe(
      "stock-ravioles",
    );
    expect(primerCampoConError([milanesa], errores)).toBeNull();
  });

  it("[TC-U-366] una venta mientras se edita actualiza lo que no se tocó y respeta lo tocado", () => {
    const formulario = formularioDesde([milanesa, flan]);
    formulario.flan = { ...formulario.flan, umbral: "6" };

    const milanesaVendida = { ...milanesa, stockActual: 9 };
    const flanVendido = { ...flan, stockActual: 1 };
    const nuevo = item({ id: "tarta", categoria: POSTRES });
    const fusion = fusionarConServidor(
      [milanesa, flan],
      [milanesaVendida, flanVendido, nuevo],
      formulario,
    );
    expect(fusion).toEqual({
      milanesa: { controlaStock: true, stock: "9", umbral: "5" },
      flan: { controlaStock: true, stock: "1", umbral: "6" },
      tarta: { controlaStock: false, stock: "0", umbral: "5" },
    });

    // Lo que el administrador escribió no se pisa, y un ítem que ya no
    // está en la carta se quita.
    formulario.milanesa = { controlaStock: false, stock: "4", umbral: "5" };
    expect(
      fusionarConServidor([milanesa, flan], [milanesaVendida], formulario),
    ).toEqual({ milanesa: { controlaStock: false, stock: "4", umbral: "5" } });
  });

  it("[TC-U-367] lo que devuelve el PATCH reemplaza a esos ítems y el resto queda igual", () => {
    const flanRepuesto = { ...flan, stockActual: 20, alerta: null };
    expect(reemplazarItems([milanesa, flan, ravioles], [flanRepuesto])).toEqual(
      [milanesa, flanRepuesto, ravioles],
    );
  });

  it("[TC-U-368] resumen y textos de la pantalla", () => {
    const agotado = item({
      id: "pollo",
      controlaStock: true,
      alerta: "AGOTADO",
    });
    expect(resumenStock([milanesa, flan, ravioles, agotado])).toEqual({
      controlados: 3,
      porAgotarse: 1,
      agotados: 1,
    });
    expect(textoGuardado(1)).toBe("Se guardó 1 ítem.");
    expect(textoGuardado(3)).toBe("Se guardaron 3 ítems.");
    expect(textoPendientes(0)).toBe("");
    expect(textoPendientes(1)).toBe("Hay 1 ítem con cambios sin guardar.");
    expect(textoPendientes(2)).toBe("Hay 2 ítems con cambios sin guardar.");
  });
});
