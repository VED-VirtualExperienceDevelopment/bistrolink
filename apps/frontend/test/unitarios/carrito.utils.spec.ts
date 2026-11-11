import {
  anuncioAgregado,
  cantidadEnCarrito,
  CONSULTA_PANTALLA_ANCHA,
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
