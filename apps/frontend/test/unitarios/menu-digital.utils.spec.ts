import {
  origenPedido,
  RUTA_AUTH_COMENSAL,
  solicitudAuthComensal,
} from "@/components/menu-digital.utils";

// BL-309: los pedidos desde una mesa fallaban porque el frontend pedía el
// token a /auth/comensal/mesa, una ruta que no existe en el backend (404).

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const MESA_ID = "33333333-3333-3333-3333-333333333333";
const RESTAURANTE_ID = "22222222-2222-2222-2222-222222222222";

describe("solicitudAuthComensal", () => {
  it("la ruta es la que expone el backend (POST /auth/comensal)", () => {
    expect(RUTA_AUTH_COMENSAL).toBe("/auth/comensal");
  });

  it.each(["mesa", "publico"] as const)(
    "menú de tipo %s: usa /auth/comensal (nunca /auth/comensal/mesa)",
    (tipo) => {
      const { ruta } = solicitudAuthComensal(tipo, TENANT_ID, MESA_ID);

      expect(ruta).toBe("/auth/comensal");
      expect(ruta).not.toBe("/auth/comensal/mesa");
    },
  );

  it("menú de mesa: manda tenantId y mesaId", () => {
    expect(solicitudAuthComensal("mesa", TENANT_ID, MESA_ID).body).toEqual({
      tenantId: TENANT_ID,
      mesaId: MESA_ID,
    });
  });

  it("link web del local: manda tenantId y restauranteId", () => {
    expect(
      solicitudAuthComensal("publico", TENANT_ID, RESTAURANTE_ID).body,
    ).toEqual({
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
    });
  });
});

describe("origenPedido", () => {
  it("menú de mesa: el pedido va a la mesa", () => {
    expect(origenPedido("mesa", MESA_ID)).toEqual({ mesaId: MESA_ID });
  });

  it("link web del local: el pedido va al restaurante (mesa virtual)", () => {
    expect(origenPedido("publico", RESTAURANTE_ID)).toEqual({
      restauranteId: RESTAURANTE_ID,
    });
  });

  it("nunca manda los dos campos a la vez", () => {
    expect(Object.keys(origenPedido("mesa", MESA_ID))).toEqual(["mesaId"]);
    expect(Object.keys(origenPedido("publico", RESTAURANTE_ID))).toEqual([
      "restauranteId",
    ]);
  });
});
