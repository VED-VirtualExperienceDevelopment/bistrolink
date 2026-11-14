import {
  EXPLICACION_MAS_PEDIDO,
  insigniasDelPlato,
} from "@/components/menu-digital/insignias.utils";

// HU-044 (BL-537): insignias del plato en el menú del comensal.

describe("insigniasDelPlato", () => {
  it("un plato sugerido y disponible lleva «Sugerencia del local»", () => {
    expect(insigniasDelPlato({ disponible: true, destacado: true })).toEqual([
      "sugerencia",
    ]);
  });

  it("sin marcar (o de un backend que no manda el dato) no lleva ninguna", () => {
    expect(insigniasDelPlato({ disponible: true, destacado: false })).toEqual(
      [],
    );
    expect(insigniasDelPlato({ disponible: true })).toEqual([]);
  });

  it("agotado: ninguna insignia, aunque esté sugerido (solo «No disponible»)", () => {
    expect(insigniasDelPlato({ disponible: false, destacado: true })).toEqual(
      [],
    );
  });
});

describe("insigniasDelPlato: «Más pedido» (HU-045, BL-548)", () => {
  it("un plato entre los más pedidos lleva la insignia", () => {
    expect(insigniasDelPlato({ disponible: true, masPedido: true })).toEqual([
      "masPedido",
    ]);
  });

  it("con las dos, primero la del local y después la de las ventas", () => {
    expect(
      insigniasDelPlato({ disponible: true, destacado: true, masPedido: true }),
    ).toEqual(["sugerencia", "masPedido"]);
  });

  it("agotado: ninguna, aunque esté entre los más pedidos", () => {
    expect(
      insigniasDelPlato({
        disponible: false,
        destacado: true,
        masPedido: true,
      }),
    ).toEqual([]);
  });

  it("explica de dónde sale, para el lector de pantalla y el title", () => {
    expect(EXPLICACION_MAS_PEDIDO).toBe(
      "Entre los 3 platos más pedidos del local en los últimos 30 días",
    );
  });
});
