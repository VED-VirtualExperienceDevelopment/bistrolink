import {
  MEDIOS_SIN_CONSULTA,
  mediosDisponibles,
  mensajeSinMedios,
  metodoSegunMedios,
  opcionesDePago,
} from "@/components/pago/pago.utils";

// BL-452: el comensal ve solo los medios de pago que el local tiene
// habilitados (HU-020): tarjeta (Mercado Pago) y efectivo.

describe("medios de pago disponibles (BL-452)", () => {
  it("[TC-U-266] BL-452: lee la tarjeta y el efectivo de GET .../pagos; sin el dato de la tarjeta, la ofrece como antes", () => {
    expect(
      mediosDisponibles({
        tarjeta: { disponible: false },
        efectivo: { disponible: true, solicitadoEn: null, pagaCon: null },
      }),
    ).toEqual({ tarjeta: false, efectivo: true });
    // Backend anterior a BL-452 (sin `tarjeta`) y pedido para retirar (sin
    // efectivo): solo la tarjeta, como hasta ahora.
    expect(mediosDisponibles({})).toEqual({ tarjeta: true, efectivo: false });
    expect(MEDIOS_SIN_CONSULTA).toEqual({ tarjeta: true, efectivo: false });
  });

  it("[TC-U-267] BL-452: con los dos medios, el selector; con uno, ese medio directo; sin ninguno, el aviso", () => {
    expect(opcionesDePago({ tarjeta: true, efectivo: true })).toEqual({
      tipo: "selector",
    });
    expect(opcionesDePago({ tarjeta: true, efectivo: false })).toEqual({
      tipo: "solo",
      metodo: "tarjeta",
    });
    expect(opcionesDePago({ tarjeta: false, efectivo: true })).toEqual({
      tipo: "solo",
      metodo: "efectivo",
    });
    expect(opcionesDePago({ tarjeta: false, efectivo: false })).toEqual({
      tipo: "ninguno",
    });
  });

  it("[TC-U-268] BL-452: el método elegido cambia solo si el actual ya no está disponible", () => {
    const soloEfectivo = { tarjeta: false, efectivo: true };
    const soloTarjeta = { tarjeta: true, efectivo: false };
    const ambos = { tarjeta: true, efectivo: true };

    expect(metodoSegunMedios(soloEfectivo, "tarjeta")).toBe("efectivo");
    expect(metodoSegunMedios(soloTarjeta, "efectivo")).toBe("tarjeta");
    expect(metodoSegunMedios(ambos, "efectivo")).toBe("efectivo");
    expect(metodoSegunMedios(ambos, "tarjeta")).toBe("tarjeta");
  });

  it("sin medios, el aviso deriva al mozo en la mesa y al local en un pedido para retirar", () => {
    expect(mensajeSinMedios("mesa")).toMatch(/mozo/);
    expect(mensajeSinMedios("publico")).toMatch(/Acercate al local/);
  });
});
