import {
  categoriasDeRespuesta,
  conAvisoDeCartaActualizada,
  debeRecargarAlVolver,
  ESPERA_MINIMA_RECARGA_MS,
  esRechazoPorLaCarta,
  rutaCartaVigente,
} from "@/components/menu-digital/carta-vigente.utils";

// BL-570: la carta del comensal vuelve a pedir la disponibilidad al volver a
// la pestaña y cuando el pedido se rechaza por un plato que ya no se puede
// pedir.

describe("debeRecargarAlVolver", () => {
  it("[TC-U-562] recarga al volver a la pestaña solo si pasó la espera mínima", () => {
    const cargada = 1_000_000;
    expect(ESPERA_MINIMA_RECARGA_MS).toBe(30_000);
    expect(debeRecargarAlVolver(true, cargada, cargada + 30_000)).toBe(true);
    expect(debeRecargarAlVolver(true, cargada, cargada + 29_999)).toBe(false);
    // Al ocultarse la pestaña no se pide nada.
    expect(debeRecargarAlVolver(false, cargada, cargada + 60_000)).toBe(false);
  });
});

describe("rutaCartaVigente", () => {
  it("[TC-U-563] la misma ruta de la API que usa la página, según la entrada", () => {
    expect(
      rutaCartaVigente({
        tipo: "mesa",
        qrToken: "abc/def",
      } as Parameters<typeof rutaCartaVigente>[0]),
    ).toBe("/menu/qr/abc%2Fdef");
    expect(
      rutaCartaVigente({
        tipo: "publico",
        tenantId: "t-1",
        restauranteId: "r-1",
      } as Parameters<typeof rutaCartaVigente>[0]),
    ).toBe("/menu/tenant/t-1/restaurante/r-1");
    // Pago por link no muestra la carta.
    expect(
      rutaCartaVigente({ tipo: "link" } as Parameters<
        typeof rutaCartaVigente
      >[0]),
    ).toBeNull();
  });
});

describe("esRechazoPorLaCarta", () => {
  it("[TC-U-564] solo los rechazos por un plato agotado, sin stock o fuera de la carta", () => {
    expect(esRechazoPorLaCarta(400, '"Pizza" no está disponible')).toBe(true);
    expect(esRechazoPorLaCarta(409, '"Pizza" está agotado')).toBe(true);
    expect(
      esRechazoPorLaCarta(409, 'No hay stock suficiente de "Pizza": quedan 2'),
    ).toBe(true);
    expect(
      esRechazoPorLaCarta(
        400,
        "El ítem 123 no existe en la carta de este restaurante",
      ),
    ).toBe(true);

    // Errores con código (retiro cerrado, mesa cerrada): tienen su aviso.
    expect(
      esRechazoPorLaCarta(
        409,
        "No estamos tomando pedidos",
        "RETIRO_NO_DISPONIBLE",
      ),
    ).toBe(false);
    // Otros 400 (datos del pedido) y otros estados: la carta no cambió.
    expect(
      esRechazoPorLaCarta(
        400,
        "Se requiere restauranteId para un pedido sin mesa",
      ),
    ).toBe(false);
    expect(esRechazoPorLaCarta(500, '"Pizza" no está disponible')).toBe(false);
  });

  it("[TC-U-565] el aviso dice qué hacer y no muestra ids internos", () => {
    expect(conAvisoDeCartaActualizada('"Pizza" está agotado')).toBe(
      '"Pizza" está agotado. Actualizamos la carta: revisá tu pedido y sacá lo que ya no está disponible.',
    );
    const aviso = conAvisoDeCartaActualizada(
      "El ítem 5f0c9a2e-1111-4111-8111-111111111111 no existe en la carta de este restaurante",
    );
    expect(aviso).toMatch(/^Un plato de tu pedido ya no está en la carta\./);
    expect(aviso).not.toContain("5f0c9a2e");
  });
});

describe("categoriasDeRespuesta", () => {
  it("toma las categorías de la respuesta de la API", () => {
    const categorias = [{ id: "c-1", nombre: "Platos", items: [] }];
    expect(categoriasDeRespuesta({ categorias })).toEqual(categorias);
  });

  it("si la respuesta no tiene la forma esperada, null (queda la carta que estaba)", () => {
    expect(categoriasDeRespuesta(null)).toBeNull();
    expect(categoriasDeRespuesta({})).toBeNull();
    expect(categoriasDeRespuesta({ categorias: [{ nombre: "x" }] })).toBeNull();
  });
});
