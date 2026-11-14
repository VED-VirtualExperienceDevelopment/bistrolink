import {
  AVISO_PEDIDO_NO_PENDIENTE,
  anuncioPedidoDestacado,
  codigoDelPedido,
  desglosePropina,
  esTotalCambiado,
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
  resolverPedidoDestacado,
  resumenDeLineas,
  rutaCancelarPendiente,
  rutaCobrarPedido,
  textoPropinaEnLista,
  type PedidoPendienteDeCobro,
  motivoSinLink,
  AVISO_OTRO_LINK,
  CODIGO_LINK_ACTIVO,
  cuerpoLinkPago,
  rutaLinkPago,
  textoLinkActivo,
  textoVencimientoLink,
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

/** Un pedido de 590 con 10 % de propina: total 649. */
function pedidoConPropina(
  overrides: Partial<PedidoPendienteDeCobro> = {},
): PedidoPendienteDeCobro {
  return pedido({
    total: "649.00",
    consumo: "590.00",
    propina: "59.00",
    propinaPorcentaje: 10,
    ...overrides,
  });
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

    it("con propina el vuelto se calcula sobre el total (consumo + propina)", () => {
      expect(evaluarMontoRecibido("1000", "649.00")).toEqual({
        tipo: "ok",
        recibido: "1000",
        vuelto: "351.00",
      });
      expect(evaluarMontoRecibido("600", "649.00")).toEqual({
        tipo: "insuficiente",
        falta: "49.00",
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

// HU-022 (BL-495): el mozo ve la propina que eligió el comensal.
describe("la propina en el cobro (HU-022, BL-495)", () => {
  const pedidoId = "3f2a9c1e-0000-4000-8000-000000000001";

  describe("desglosePropina", () => {
    it("con porcentaje: consumo, propina y etiqueta con el porcentaje", () => {
      expect(desglosePropina(pedidoConPropina())).toEqual({
        consumo: "590.00",
        propina: "59.00",
        etiqueta: "Propina (10 %)",
      });
    });

    it("con monto libre (sin porcentaje): etiqueta sin porcentaje", () => {
      expect(
        desglosePropina(pedidoConPropina({ propinaPorcentaje: null })),
      ).toMatchObject({ propina: "59.00", etiqueta: "Propina" });
    });

    it("sin propina: no hay desglose", () => {
      expect(desglosePropina(pedido())).toBeNull();
      expect(
        desglosePropina(
          pedido({ consumo: "590.00", propina: "0.00", total: "590.00" }),
        ),
      ).toBeNull();
    });

    it("un backend anterior no informa el consumo: no hay desglose", () => {
      expect(desglosePropina(pedido({ propina: "59.00" }))).toBeNull();
    });
  });

  describe("textoPropinaEnLista", () => {
    it("con porcentaje", () => {
      expect(textoPropinaEnLista(pedidoConPropina())).toBe(
        `Incluye propina de ${formatearMonto("59.00")} (10 %)`,
      );
    });

    it("con monto libre: sin porcentaje", () => {
      expect(
        textoPropinaEnLista(pedidoConPropina({ propinaPorcentaje: null })),
      ).toBe(`Incluye propina de ${formatearMonto("59.00")}`);
    });

    it("sin propina: nada", () => {
      expect(textoPropinaEnLista(pedido())).toBeNull();
    });
  });

  describe("esTotalCambiado", () => {
    it("reconoce el 409 del backend por cambio de propina", () => {
      expect(
        esTotalCambiado(
          "El total del pedido cambió: ahora es $ 679.00. Actualizá la lista antes de cobrar.",
        ),
      ).toBe(true);
    });

    it("no confunde otros errores", () => {
      expect(esTotalCambiado("Este pedido ya fue pagado")).toBe(false);
      expect(esTotalCambiado("")).toBe(false);
    });
  });

  describe("mensajeCobroRegistrado con propina", () => {
    const cobro = {
      pagoId: "p",
      pedidoId,
      monto: "649.00",
      consumo: "590.00",
      propina: "59.00",
      montoRecibido: "1000.00",
      vuelto: "351.00",
    };

    it("dice la propina y el vuelto", () => {
      expect(mensajeCobroRegistrado(cobro)).toBe(
        `Cobro registrado: pedido #3F2A9C. Propina: ${formatearMonto("59.00")}. Vuelto: ${formatearMonto("351.00")}. Ya está en cocina.`,
      );
    });

    it("con el monto justo: dice la propina y que no hay vuelto", () => {
      expect(
        mensajeCobroRegistrado({
          ...cobro,
          montoRecibido: "649.00",
          vuelto: "0.00",
        }),
      ).toBe(
        `Cobro registrado: pedido #3F2A9C. Propina: ${formatearMonto("59.00")}. Sin vuelto. Ya está en cocina.`,
      );
    });

    it("con propina en cero se avisa igual que sin propina", () => {
      expect(
        mensajeCobroRegistrado({
          ...cobro,
          monto: "590.00",
          propina: "0.00",
          vuelto: "0.00",
        }),
      ).toBe("Cobro registrado: pedido #3F2A9C, sin vuelto. Ya está en cocina.");
    });
  });

  describe("mensajeCobroPosRegistrado con propina", () => {
    it("aclara que el total incluye la propina", () => {
      expect(
        mensajeCobroPosRegistrado({
          pagoId: "p-1",
          pedidoId,
          monto: "649.00",
          consumo: "590.00",
          propina: "59.00",
          tarjeta: "DEBITO",
          autorizacion: "A1B2C3",
        }),
      ).toBe(
        `Cobro registrado: pedido #3F2A9C, ${formatearMonto("649.00")} (incluye propina de ${formatearMonto("59.00")}) con débito (autorización A1B2C3). Ya está en cocina.`,
      );
    });
  });
});

// BL-470: «Ir a cobrar» en el aviso de efectivo de las alertas.
describe("«Ir a cobrar» desde las alertas (BL-470)", () => {
  const enMesa = pedido();
  const retiro = pedido({
    id: "aa11bb22-0000-4000-8000-000000000002",
    mesa: { id: "virtual", numero: 0, esVirtual: true },
  });

  it("rutaCobrarPedido: con el pedido en el parámetro, o sin parámetro", () => {
    expect(rutaCobrarPedido("p-1")).toBe("/admin/cobros?pedido=p-1");
    expect(rutaCobrarPedido(undefined)).toBe("/admin/cobros");
  });

  it("anuncia el pedido destacado con su mesa, o para retirar", () => {
    expect(anuncioPedidoDestacado(enMesa)).toBe(
      "Pedido #3F2A9C de la mesa 3, esperando cobro.",
    );
    expect(anuncioPedidoDestacado(retiro)).toBe(
      "Pedido #AA11BB para retirar, esperando cobro.",
    );
  });

  it("sin parámetro no destaca nada", () => {
    expect(resolverPedidoDestacado([enMesa], null)).toEqual({
      tipo: "ninguno",
    });
  });

  it("destaca el pedido si sigue pendiente", () => {
    expect(resolverPedidoDestacado([retiro, enMesa], enMesa.id)).toEqual({
      tipo: "pendiente",
      pedidoId: enMesa.id,
      anuncio: "Pedido #3F2A9C de la mesa 3, esperando cobro.",
    });
  });

  it("avisa si el pedido ya no está pendiente", () => {
    expect(resolverPedidoDestacado([retiro], enMesa.id)).toEqual({
      tipo: "no-pendiente",
      anuncio: AVISO_PEDIDO_NO_PENDIENTE,
    });
  });
});

describe("link de pago (HU-033, BL-203)", () => {
  const AHORA = Date.parse("2026-11-14T23:00:00.000Z");

  it("ruta del POST que genera el link", () => {
    expect(rutaLinkPago("3f2a9c1e-0000-4000-8000-000000000001")).toBe(
      "/cobros/pendientes/3f2a9c1e-0000-4000-8000-000000000001/link-pago",
    );
  });

  it("el POST dice si reemplaza el link activo (solo si el colaborador confirmó)", () => {
    expect(JSON.parse(cuerpoLinkPago(false))).toEqual({ reemplazar: false });
    expect(JSON.parse(cuerpoLinkPago(true))).toEqual({ reemplazar: true });
  });

  it("si otro colaborador ya generó el link, el aviso lo dice (código del 409)", () => {
    expect(CODIGO_LINK_ACTIVO).toBe("LINK_PAGO_ACTIVO");
    expect(AVISO_OTRO_LINK).toContain("Otro colaborador");
  });

  it("con un pago con tarjeta en curso no se genera", () => {
    expect(motivoSinLink(pedido())).toBeNull();
    expect(motivoSinLink(pedido({ pagoEnCurso: true }))).toBe(
      motivoSinCancelar(pedido({ pagoEnCurso: true })),
    );
  });

  it("muestra el link activo solo si no venció (hora de Uruguay)", () => {
    expect(
      textoLinkActivo(
        pedido({ linkPagoVenceEn: "2026-11-14T23:15:00.000Z" }),
        AHORA,
      ),
    ).toBe("Link de pago activo hasta las 20:15");
    expect(
      textoLinkActivo(
        pedido({ linkPagoVenceEn: "2026-11-14T22:59:00.000Z" }),
        AHORA,
      ),
    ).toBeNull();
    expect(
      textoLinkActivo(pedido({ linkPagoVenceEn: null }), AHORA),
    ).toBeNull();
    expect(textoLinkActivo(pedido(), AHORA)).toBeNull();
  });

  it("vencimiento con los minutos que faltan, o que venció", () => {
    expect(textoVencimientoLink("2026-11-14T23:15:00.000Z", AHORA)).toBe(
      "Vence a las 20:15 (en 15 min)",
    );
    expect(textoVencimientoLink("2026-11-14T23:00:30.000Z", AHORA)).toBe(
      "Vence a las 20:00 (en 1 min)",
    );
    expect(textoVencimientoLink("2026-11-14T23:00:00.000Z", AHORA)).toBe(
      "Este link venció. Generá otro.",
    );    // Una fecha que no se puede leer cuenta como vencido.
    expect(textoVencimientoLink("no-es-fecha", AHORA)).toBe(
      "Este link venció. Generá otro.",
    );
  });
});
