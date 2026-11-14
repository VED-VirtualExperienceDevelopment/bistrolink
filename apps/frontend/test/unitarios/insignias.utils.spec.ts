import { insigniasDelPlato } from "@/components/menu-digital/insignias.utils";

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
