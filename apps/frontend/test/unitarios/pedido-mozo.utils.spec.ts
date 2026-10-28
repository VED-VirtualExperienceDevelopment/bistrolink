import {
  armarPedido,
  cambiarCantidad,
  cambiarNota,
  cantidadDeItems,
  categoriasParaPedir,
  CANTIDAD_MAXIMA_POR_ITEM,
  LARGO_NOTA_GENERAL,
  LARGO_NOTA_ITEM,
  nuevaClaveDePedido,
  rutaCargarPedido,
  totalDelCarrito,
  type CategoriaCartaStaff,
} from "@/components/admin/pedido-mozo/pedido-mozo.utils";

// HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular.

const CARTA: CategoriaCartaStaff[] = [
  {
    id: "c1",
    nombre: "Principales",
    activo: true,
    items: [
      { id: "hamb", nombre: "Hamburguesa", precio: "560", disponible: true },
      { id: "agua", nombre: "Agua", precio: 120.5, disponible: false },
    ],
  },
  { id: "c2", nombre: "Vacía", items: [] },
  {
    id: "c3",
    nombre: "Inactiva",
    activo: false,
    items: [{ id: "x", nombre: "X", precio: "1", disponible: true }],
  },
  {
    id: "c4",
    nombre: "Acompañamientos",
    items: [{ id: "papas", nombre: "Papas", precio: "250.10", disponible: true }],
  },
];

describe("pedido-mozo.utils (HU-039, BL-209)", () => {
  it("rutaCargarPedido: mesa y número en la URL", () => {
    expect(rutaCargarPedido("m-1", 3)).toBe("/admin/mesas/pedido?mesa=m-1&numero=3");
  });

  it("categoriasParaPedir: sin las inactivas ni las vacías", () => {
    expect(categoriasParaPedir(CARTA).map((c) => c.id)).toEqual(["c1", "c4"]);
  });

  describe("carrito", () => {
    it("suma y resta unidades; en 0 el ítem sale", () => {
      let c = cambiarCantidad({}, "hamb", 1);
      c = cambiarCantidad(c, "hamb", 1);
      expect(c).toEqual({ hamb: { cantidad: 2, observacion: "" } });
      c = cambiarCantidad(cambiarCantidad(c, "hamb", -1), "hamb", -1);
      expect(c).toEqual({});
    });

    it("no baja de 0 ni pasa el tope", () => {
      expect(cambiarCantidad({}, "hamb", -1)).toEqual({});
      expect(cambiarCantidad({}, "hamb", 500).hamb.cantidad).toBe(CANTIDAD_MAXIMA_POR_ITEM);
    });

    it("conserva la nota al cambiar la cantidad", () => {
      const c = cambiarNota(cambiarCantidad({}, "hamb", 1), "hamb", "Sin sal");
      expect(cambiarCantidad(c, "hamb", 1).hamb).toEqual({ cantidad: 2, observacion: "Sin sal" });
    });

    it("cambiarNota: solo si el ítem está en el carrito, con el tope de largo", () => {
      expect(cambiarNota({}, "hamb", "x")).toEqual({});
      const c = cambiarNota(cambiarCantidad({}, "hamb", 1), "hamb", "a".repeat(400));
      expect(c.hamb.observacion).toHaveLength(LARGO_NOTA_ITEM);
    });

    it("cantidad y total (en centésimos, con precios texto o número)", () => {
      const c = cambiarCantidad(cambiarCantidad(cambiarCantidad({}, "hamb", 2), "papas", 1), "agua", 1);
      expect(cantidadDeItems(c)).toBe(4);
      expect(totalDelCarrito(c, CARTA)).toBe("1490.60");
      expect(totalDelCarrito({}, CARTA)).toBe("0.00");
      expect(totalDelCarrito({ inexistente: { cantidad: 1, observacion: "" } }, CARTA)).toBe("0.00");
    });
  });

  describe("armarPedido", () => {
    it("arma el body con la mesa, la clave, los ítems y la nota", () => {
      const c = cambiarNota(cambiarCantidad(cambiarCantidad({}, "hamb", 2), "papas", 1), "hamb", "  Sin sal ");
      expect(armarPedido("m-1", c, " Celíaco ", "clave")).toEqual({
        mesaId: "m-1",
        idempotencyKey: "clave",
        items: [
          { itemCartaId: "hamb", cantidad: 2, observacion: "Sin sal" },
          { itemCartaId: "papas", cantidad: 1 },
        ],
        observacionGeneral: "Celíaco",
      });
    });

    it("sin nota general: no la manda; con una muy larga, la recorta", () => {
      expect(armarPedido("m", {}, "   ", "k")).not.toHaveProperty("observacionGeneral");
      expect(armarPedido("m", {}, "a".repeat(600), "k").observacionGeneral).toHaveLength(LARGO_NOTA_GENERAL);
    });
  });

  it("nuevaClaveDePedido: distinta cada vez y de hasta 64 caracteres", () => {
    const a = nuevaClaveDePedido();
    expect(a).not.toBe(nuevaClaveDePedido());
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/^mozo-/);
  });
});
