import {
  codigoDelPedido,
  evaluarMontoRecibido,
  formatearMonto,
  horaDelPedido,
  mensajeCobroPosRegistrado,
  mensajeCobroRegistrado,
  mensajePendienteCancelado,
  motivoSinCancelar,
  motivoSinEfectivo,
  motivoSinPos,
  normalizarAutorizacion,
  normalizarMontoRecibido,
  nuevaClaveDeCobro,
  nuevaClaveDeCobroPos,
  pendientesDeLaMesa,
  pendientesEnMesas,
  pendientesParaRetirar,
  resumenDeLineas,
  rutaCancelarPendiente,
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
      mensajeCobroRegistrado({
        ...cobro,
        montoRecibido: "590.00",
        vuelto: "0.00",
      }),
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

describe("cobros.utils: POS del local (HU-007b, BL-80)", () => {
  it.each([
    ["A1B2C3", "A1B2C3"],
    [" ab-12 3c ", "AB123C"],
    ["1234", "1234"],
    ["123456789012", "123456789012"],
  ])("normalizarAutorizacion(%p) = %p", (texto, esperado) => {
    expect(normalizarAutorizacion(texto)).toBe(esperado);
  });

  it.each([
    ["muy corta", "123"],
    ["con 16 dígitos (parece un número de tarjeta)", "4111111111111111"],
    ["con símbolos", "AB#123"],
    ["vacía", ""],
  ])("normalizarAutorizacion rechaza una autorización %s", (_caso, texto) => {
    expect(normalizarAutorizacion(texto)).toBeNull();
  });

  it("motivoSinPos: deshabilitado o con un pago con tarjeta en curso", () => {
    expect(motivoSinPos(pedido(), true)).toBeNull();
    expect(motivoSinPos(pedido(), false)).toContain("no está habilitado");
    expect(motivoSinPos(pedido({ pagoEnCurso: true }), true)).toContain(
      "está pagando con tarjeta",
    );
  });

  it("mensajeCobroPosRegistrado: pedido, total, tarjeta y autorización", () => {
    expect(
      mensajeCobroPosRegistrado({
        pagoId: "p-1",
        pedidoId: "3f2a9c1e-0000-4000-8000-000000000001",
        monto: "590.00",
        tarjeta: "DEBITO",
        autorizacion: "A1B2C3",
      }),
    ).toBe(
      `Cobro registrado: pedido #3F2A9C, ${formatearMonto("590.00")} con débito (autorización A1B2C3). Ya está en cocina.`,
    );
  });

  it("nuevaClaveDeCobroPos: una clave distinta por cobro, de hasta 64 caracteres", () => {
    const a = nuevaClaveDeCobroPos();
    expect(a).toMatch(/^pos-/);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(nuevaClaveDeCobroPos()).not.toBe(a);
  });
});

// BL-501: cancelar un pedido que todavía no se cobró.
describe("cancelar un pedido sin cobrar (BL-501)", () => {
  it("la ruta lleva el id del pedido", () => {
    expect(rutaCancelarPendiente("3f2a9c1e-0000-4000-8000-000000000001")).toBe(
      "/cobros/pendientes/3f2a9c1e-0000-4000-8000-000000000001/cancelar",
    );
  });

  it("con un pago con tarjeta en curso no se cancela, con el mismo motivo que el efectivo", () => {
    expect(motivoSinCancelar(pedido())).toBeNull();
    const enCurso = pedido({ pagoEnCurso: true });
    expect(motivoSinCancelar(enCurso)).toBe(motivoSinEfectivo(enCurso, true));
    expect(motivoSinCancelar(enCurso)).toMatch(/pagando con tarjeta/);
  });

  it("aviso con el código del pedido", () => {
    expect(
      mensajePendienteCancelado({
        pedidoId: "3f2a9c1e-0000-4000-8000-000000000001",
        estado: "CANCELADO",
        total: "590.00",
      }),
    ).toBe(
      `Pedido ${codigoDelPedido("3f2a9c1e-0000-4000-8000-000000000001")} cancelado. No se cobró y no pasa a cocina.`,
    );
  });
});
