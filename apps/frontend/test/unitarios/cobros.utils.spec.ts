import {
  codigoDelPedido,
  evaluarMontoRecibido,
  formatearMonto,
  horaDelPedido,
  mensajeCobroRegistrado,
  motivoSinEfectivo,
  normalizarMontoRecibido,
  nuevaClaveDeCobro,
  pendientesDeLaMesa,
  pendientesEnMesas,
  pendientesParaRetirar,
  resumenDeLineas,
  type PedidoPendienteDeCobro,
} from "@/components/admin/cobros/cobros.utils";

// HU-031 (BL-201): cobro en efectivo (panel de la mesa y /admin/cobros).

function pedido(
  overrides: Partial<PedidoPendienteDeCobro> = {},
): PedidoPendienteDeCobro {
  return {
    id: "3f2a9c1e-0000-4000-8000-000000000001",
    canal: "QR",
    createdAt: "2026-10-28T18:05:00.000Z",
    mesa: { id: "mesa-3", numero: 3, esVirtual: false },
    total: "590.00",
    lineas: [
      { id: "l-1", nombre: "Milanesa", cantidad: 1, subtotal: "390.00" },
      { id: "l-2", nombre: "Agua", cantidad: 2, subtotal: "200.00" },
    ],
    pagoEnCurso: false,
    ...overrides,
  };
}

describe("cobros.utils (HU-031, BL-201)", () => {
  it("codigoDelPedido: el mismo código que ve el comensal", () => {
    expect(codigoDelPedido("3f2a9c1e-0000-4000-8000-000000000001")).toBe(
      "#3F2A9C",
    );
  });

  it("separa los pedidos por mesa, para retirar y de las mesas", () => {
    const retiro = pedido({
      id: "r",
      canal: "WEB",
      mesa: { id: "virtual", numero: 0, esVirtual: true },
    });
    const mesa3 = pedido({ id: "m3" });
    const mesa5 = pedido({
      id: "m5",
      mesa: { id: "mesa-5", numero: 5, esVirtual: false },
    });
    const todos = [retiro, mesa3, mesa5];

    expect(pendientesDeLaMesa(todos, "mesa-3")).toEqual([mesa3]);
    expect(pendientesParaRetirar(todos)).toEqual([retiro]);
    expect(pendientesEnMesas(todos)).toEqual([mesa3, mesa5]);
  });

  it("formatearMonto: sin decimales si no hacen falta, con centésimos si hay", () => {
    expect(formatearMonto("590.00")).toMatch(/590$/);
    expect(formatearMonto("10.50")).toMatch(/10,5/);
  });

  it("horaDelPedido: en hora de Uruguay", () => {
    expect(horaDelPedido("2026-10-28T18:05:00.000Z")).toBe("15:05");
  });

  it("resumenDeLineas", () => {
    expect(resumenDeLineas(pedido())).toBe("1 × Milanesa, 2 × Agua");
  });

  it.each([
    ["1000", "1000"],
    [" 1000,5 ", "1000.5"],
    ["1000.50", "1000.50"],
    ["0", "0"],
  ])("normalizarMontoRecibido(%p) = %p", (texto, esperado) => {
    expect(normalizarMontoRecibido(texto)).toBe(esperado);
  });

  it.each([["-10"], ["10.123"], ["abc"], ["1e3"], ["123456789"], ["10,5,0"]])(
    "normalizarMontoRecibido rechaza %p",
    (texto) => {
      expect(normalizarMontoRecibido(texto)).toBeNull();
    },
  );

  describe("evaluarMontoRecibido", () => {
    it("vacío", () => {
      expect(evaluarMontoRecibido("  ", "590.00")).toEqual({ tipo: "vacio" });
    });

    it("inválido", () => {
      expect(evaluarMontoRecibido("mil", "590.00")).toEqual({
        tipo: "invalido",
      });
    });

    it("insuficiente: dice cuánto falta", () => {
      expect(evaluarMontoRecibido("500", "590.00")).toEqual({
        tipo: "insuficiente",
        falta: "90.00",
      });
    });

    it("calcula el vuelto en centésimos, sin errores de punto flotante", () => {
      expect(evaluarMontoRecibido("1000,10", "590.30")).toEqual({
        tipo: "ok",
        recibido: "1000.10",
        vuelto: "409.80",
      });
    });

    it("monto justo: vuelto 0", () => {
      expect(evaluarMontoRecibido("590", "590.00")).toEqual({
        tipo: "ok",
        recibido: "590",
        vuelto: "0.00",
      });
    });
  });

  describe("motivoSinEfectivo", () => {
    it("se puede cobrar", () => {
      expect(motivoSinEfectivo(pedido(), true)).toBeNull();
    });

    it("efectivo deshabilitado", () => {
      expect(motivoSinEfectivo(pedido(), false)).toContain("no está habilitado");
    });

    it("pago con tarjeta en curso", () => {
      expect(motivoSinEfectivo(pedido({ pagoEnCurso: true }), true)).toContain(
        "pagando con tarjeta",
      );
    });
  });

  it("mensajeCobroRegistrado: con y sin vuelto", () => {
    const cobro = {
      pagoId: "p",
      pedidoId: "3f2a9c1e-0000-4000-8000-000000000001",
      monto: "590.00",
      montoRecibido: "1000.00",
      vuelto: "410.00",
    };
    expect(mensajeCobroRegistrado(cobro)).toMatch(
      /^Cobro registrado: pedido #3F2A9C\. Vuelto: .*410\. Ya está en cocina\.$/,
    );
    expect(
      mensajeCobroRegistrado({ ...cobro, montoRecibido: "590.00", vuelto: "0.00" }),
    ).toBe("Cobro registrado: pedido #3F2A9C, sin vuelto. Ya está en cocina.");
  });

  it("nuevaClaveDeCobro: una distinta cada vez, de hasta 64 caracteres", () => {
    const a = nuevaClaveDeCobro();
    const b = nuevaClaveDeCobro();
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).toMatch(/^efectivo-/);
  });
});
