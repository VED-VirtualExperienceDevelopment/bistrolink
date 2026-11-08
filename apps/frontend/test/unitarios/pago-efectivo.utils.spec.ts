import {
  evaluarPagaCon,
  mensajeEsperandoMozo,
  rutaSolicitudEfectivo,
} from "@/components/pago/pago.utils";
import {
  montoRecibidoInicial,
  textoSolicitudEfectivo,
  type PedidoPendienteDeCobro,
} from "@/components/admin/cobros/cobros.utils";
import { agregarLlamado, textoLlamado } from "@/components/kds/llamado.utils";

// HU-031b (BL-442): el comensal de una mesa elige pagar en efectivo.

describe("pago en efectivo del comensal (HU-031b, BL-442)", () => {
  it("rutaSolicitudEfectivo", () => {
    expect(rutaSolicitudEfectivo("abc")).toBe("/pedidos/abc/pagos/solicitud-efectivo");
  });

  describe("evaluarPagaCon («¿Con cuánto vas a pagar?»)", () => {
    it.each([[""], ["   "]])("vacío (%p): es opcional", (texto) => {
      expect(evaluarPagaCon(texto, 810)).toEqual({ tipo: "vacio" });
    });

    it.each([["mil"], ["-100"], ["10.123"], ["1e3"], ["123456789"]])(
      "inválido: %p",
      (texto) => {
        expect(evaluarPagaCon(texto, 810)).toEqual({ tipo: "invalido" });
      },
    );

    it("menor que el total: insuficiente", () => {
      expect(evaluarPagaCon("800", 810)).toEqual({ tipo: "insuficiente" });
    });

    it("compara en centésimos (810,50 contra 810.5)", () => {
      expect(evaluarPagaCon("810,49", 810.5)).toEqual({ tipo: "insuficiente" });
      expect(evaluarPagaCon("810,50", 810.5)).toEqual({ tipo: "ok", monto: "810.50" });
    });

    it("igual o mayor: ok, normalizado con punto", () => {
      expect(evaluarPagaCon("1000", 810)).toEqual({ tipo: "ok", monto: "1000" });
      expect(evaluarPagaCon(" 1000,5 ", 810)).toEqual({ tipo: "ok", monto: "1000.5" });
    });
  });

  it("mensajeEsperandoMozo: con y sin «con cuánto»", () => {
    expect(mensajeEsperandoMozo(810, null)).toMatch(/^Avisamos al mozo\. Tené listos .*810\.$/);
    expect(mensajeEsperandoMozo(810, "1000.00")).toMatch(
      /Le dijimos que pagás con .*1\.000, así trae el cambio\.$/,
    );
  });
});

describe("pago en efectivo del lado del mozo (HU-031b, BL-442)", () => {
  const pedido = (
    efectivoSolicitado?: PedidoPendienteDeCobro["efectivoSolicitado"],
  ): PedidoPendienteDeCobro => ({
    id: "p",
    canal: "QR",
    createdAt: "2026-10-28T17:00:00.000Z",
    mesa: { id: "m", numero: 3, esVirtual: false },
    total: "810.00",
    lineas: [],
    pagoEnCurso: false,
    efectivoSolicitado,
  });

  it("textoSolicitudEfectivo: null si no avisó (o el backend no lo trae)", () => {
    expect(textoSolicitudEfectivo(pedido(null))).toBeNull();
    expect(textoSolicitudEfectivo(pedido())).toBeNull();
  });

  it("textoSolicitudEfectivo: hora en Uruguay y con cuánto paga", () => {
    expect(
      textoSolicitudEfectivo(pedido({ en: "2026-10-28T17:30:00.000Z", pagaCon: "1000.00" })),
    ).toMatch(/^Pidió pagar en efectivo a las 14:30 · paga con .*1\.000$/);
    expect(
      textoSolicitudEfectivo(pedido({ en: "2026-10-28T17:30:00.000Z", pagaCon: null })),
    ).toBe("Pidió pagar en efectivo a las 14:30");
  });

  it("montoRecibidoInicial: precarga con cuánto dijo que paga", () => {
    expect(montoRecibidoInicial(pedido({ en: "x", pagaCon: "1000.00" }))).toBe("1000.00");
    expect(montoRecibidoInicial(pedido({ en: "x", pagaCon: null }))).toBe("");
    expect(montoRecibidoInicial(pedido())).toBe("");
  });
});

describe("llamados en el KDS (HU-019, HU-031b)", () => {
  const base = { mesaId: "m3", mesaNumero: 3, ts: 1 };

  it("llamado común: igual que antes", () => {
    expect(textoLlamado(base)).toBe("🔔 Mesa 3 solicita atención");
  });

  it("pago en efectivo: total y con cuánto paga", () => {
    expect(
      textoLlamado({ ...base, motivo: "PAGO_EFECTIVO", total: "810.00", pagaCon: "1000.00" }),
    ).toMatch(/^💵 Mesa 3 quiere pagar en efectivo: .*810 \(paga con .*1\.000\)$/);
    expect(textoLlamado({ ...base, motivo: "PAGO_EFECTIVO", total: "810.00", pagaCon: null })).toMatch(
      /^💵 Mesa 3 quiere pagar en efectivo: .*810$/,
    );
    expect(textoLlamado({ ...base, motivo: "PAGO_EFECTIVO" })).toBe(
      "💵 Mesa 3 quiere pagar en efectivo",
    );
  });

  it("agregarLlamado: uno por mesa, queda el último", () => {
    const otra = { mesaId: "m5", mesaNumero: 5, ts: 2 };
    const efectivo = { ...base, ts: 3, motivo: "PAGO_EFECTIVO" as const, total: "810.00" };

    expect(agregarLlamado([base, otra], efectivo)).toEqual([otra, efectivo]);
  });
});
