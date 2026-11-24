import {
  anuncioAgregado,
  anuncioDelCarrito,
  cantidadEnCarrito,
  conUnaMas,
  conUnaMenos,
  CONSULTA_PANTALLA_ANCHA,
  etiquetasDeLinea,
  sinLinea,
  textoItems,
} from "@/components/carrito/carrito.utils";
import { formatearPrecio } from "@/components/pago/pago.utils";

// BL-519: en el celular el carrito es una barra y el detalle se abre en una
// hoja; desde lg sigue siendo la columna de la derecha.

describe("textoItems", () => {
  it("singular con uno", () => {
    expect(textoItems(1)).toBe("1 ítem");
  });

  it("plural con más de uno", () => {
    expect(textoItems(3)).toBe("3 ítems");
  });
});

describe("cantidadEnCarrito", () => {
  const carrito = [
    { itemCartaId: "a", cantidad: 2 },
    { itemCartaId: "b", cantidad: 1 },
  ];

  it("devuelve las unidades del plato que está en el carrito", () => {
    expect(cantidadEnCarrito(carrito, "a")).toBe(2);
  });

  it("devuelve 0 si el plato no está", () => {
    expect(cantidadEnCarrito(carrito, "z")).toBe(0);
  });

  it("devuelve 0 con el carrito vacío", () => {
    expect(cantidadEnCarrito([], "a")).toBe(0);
  });
});

describe("anuncioAgregado", () => {
  it("dice qué se agregó y cómo quedó el pedido", () => {
    expect(anuncioAgregado("Milanesa", 2, 810)).toBe(
      `Agregaste Milanesa. Tu pedido: 2 ítems, ${formatearPrecio(810)}.`,
    );
  });

  it("cambia al agregar otra unidad del mismo plato (se vuelve a leer)", () => {
    expect(anuncioAgregado("Fritas", 1, 250)).not.toBe(
      anuncioAgregado("Fritas", 2, 500),
    );
  });
});

describe("CONSULTA_PANTALLA_ANCHA", () => {
  it("coincide con el corte lg de Tailwind (1024 px)", () => {
    expect(CONSULTA_PANTALLA_ANCHA).toBe("(min-width: 1024px)");
  });
});

describe("BL-378: cambiar la cantidad y quitar un plato desde el detalle", () => {
  const CARRITO = [
    {
      itemCartaId: "a",
      nombre: "Milanesa",
      cantidad: 2,
      observacion: "sin sal",
    },
    { itemCartaId: "b", nombre: "Flan", cantidad: 1 },
  ];

  it("«+» suma una unidad solo a ese plato y conserva la nota", () => {
    expect(conUnaMas(CARRITO, "a")).toEqual([
      {
        itemCartaId: "a",
        nombre: "Milanesa",
        cantidad: 3,
        observacion: "sin sal",
      },
      CARRITO[1],
    ]);
  });

  it("«+» no pasa del tope de 99 (BL-425)", () => {
    const tope = [{ itemCartaId: "a", cantidad: 99 }];
    expect(conUnaMas(tope, "a")[0].cantidad).toBe(99);
  });

  it("«−» resta una unidad y, con la última, saca el plato", () => {
    expect(conUnaMenos(CARRITO, "a")[0].cantidad).toBe(1);
    expect(conUnaMenos(CARRITO, "b")).toEqual([CARRITO[0]]);
  });

  it("«Quitar» saca el plato con todas sus unidades", () => {
    expect(sinLinea(CARRITO, "a")).toEqual([CARRITO[1]]);
    expect(sinLinea(sinLinea(CARRITO, "a"), "b")).toEqual([]);
  });

  it("un plato que no está no cambia el carrito", () => {
    expect(conUnaMas(CARRITO, "x")).toEqual(CARRITO);
    expect(conUnaMenos(CARRITO, "x")).toEqual(CARRITO);
    expect(sinLinea(CARRITO, "x")).toEqual(CARRITO);
  });

  it("no modifica el carrito original", () => {
    const copia = structuredClone(CARRITO);
    conUnaMas(CARRITO, "a");
    conUnaMenos(CARRITO, "a");
    sinLinea(CARRITO, "a");
    expect(CARRITO).toEqual(copia);
  });

  it("los botones tienen nombres accesibles con el plato", () => {
    expect(etiquetasDeLinea("Milanesa")).toEqual({
      restar: "Quitar uno de Milanesa",
      sumar: "Agregar uno de Milanesa",
      quitar: "Quitar Milanesa del pedido",
    });
  });

  it("anuncia cada cambio y cómo queda el pedido", () => {
    expect(
      anuncioDelCarrito({ tipo: "agregado", nombre: "Flan" }, 3, 1300),
    ).toBe(anuncioAgregado("Flan", 3, 1300));
    expect(
      anuncioDelCarrito({ tipo: "restado", nombre: "Milanesa" }, 2, 1180),
    ).toBe(
      `Quitaste una unidad de Milanesa. Tu pedido: 2 ítems, ${formatearPrecio(1180)}.`,
    );
    expect(
      anuncioDelCarrito({ tipo: "quitado", nombre: "Flan" }, 2, 1180),
    ).toBe(
      `Quitaste Flan del pedido. Tu pedido: 2 ítems, ${formatearPrecio(1180)}.`,
    );
  });

  it("si el pedido queda vacío, lo dice", () => {
    expect(anuncioDelCarrito({ tipo: "quitado", nombre: "Flan" }, 0, 0)).toBe(
      "Quitaste Flan del pedido. Tu pedido quedó vacío.",
    );
  });
});
