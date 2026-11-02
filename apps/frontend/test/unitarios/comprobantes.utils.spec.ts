import {
  claseEstadoDgi,
  etiquetaEstadoDgi,
  filaComprobante,
  filtrosIniciales,
  hoyEnUruguay,
  rangoInvalido,
  rutaComprobantes,
  type Comprobante,
} from "@/components/admin/comprobantes/comprobantes.utils";

// HU-009 (BL-455): pantalla de comprobantes del administrador.

const COMPROBANTE: Comprobante = {
  id: "c1",
  fechaEmision: "2026-11-03T14:05:00.000Z",
  tipoCfe: "111",
  serie: "A",
  numero: 49,
  pedidoId: "3cdf1dad-31d6-43c9-9739-11485e0e23f8",
  mesa: 5,
  canal: "QR",
  monto: "1220.00",
  estadoDgi: "RECHAZADO",
  estadoDgiMotivo: "Firma inválida",
  urlConsulta: "https://www.efactura.dgi.gub.uy/consultaQR/cfe?x",
};

describe("comprobantes.utils (HU-009, BL-455)", () => {
  it("hoy y los filtros iniciales van en hora de Uruguay", () => {
    // 01:30 UTC del 3/11 son las 22:30 del 2/11 en Montevideo.
    const ahora = new Date("2026-11-03T01:30:00.000Z");
    expect(hoyEnUruguay(ahora)).toBe("2026-11-02");
    expect(filtrosIniciales(ahora)).toEqual({
      desde: "2026-11-02",
      hasta: "2026-11-02",
      estado: "",
    });
  });

  it("arma la ruta con los filtros y la página", () => {
    expect(
      rutaComprobantes({
        desde: "2026-11-01",
        hasta: "2026-11-03",
        estado: "",
      }),
    ).toBe("/admin/comprobantes?desde=2026-11-01&hasta=2026-11-03");
    expect(
      rutaComprobantes({ desde: "", hasta: "", estado: "RECHAZADO" }, 2),
    ).toBe("/admin/comprobantes?estado=RECHAZADO&pagina=2");
    expect(rutaComprobantes({ desde: "", hasta: "", estado: "" })).toBe(
      "/admin/comprobantes",
    );
  });

  it("rango inválido si «desde» es posterior a «hasta»", () => {
    expect(
      rangoInvalido({ desde: "2026-11-03", hasta: "2026-11-01", estado: "" }),
    ).toBe(true);
    expect(
      rangoInvalido({ desde: "2026-11-01", hasta: "2026-11-01", estado: "" }),
    ).toBe(false);
    expect(rangoInvalido({ desde: "2026-11-03", hasta: "", estado: "" })).toBe(
      false,
    );
  });

  it("etiquetas y colores por estado; el rechazado resalta", () => {
    expect(etiquetaEstadoDgi("ACEPTADO")).toBe("Aceptado");
    expect(etiquetaEstadoDgi("OBSERVADO")).toBe("Observado");
    expect(claseEstadoDgi("RECHAZADO")).toContain("bg-error-container");
    expect(claseEstadoDgi("PENDIENTE")).toContain("surface-container-high");
    expect(claseEstadoDgi("ACEPTADO")).not.toBe(claseEstadoDgi("OBSERVADO"));
  });

  it("formatea la fila: fecha local, tipo, número, pedido, origen, monto, estado y enlace https", () => {
    expect(filaComprobante(COMPROBANTE)).toEqual({
      fecha: expect.stringContaining("03/11/2026"),
      tipo: "e-Factura",
      numero: "A-0000049",
      pedido: "#3CDF1D",
      origen: "Mesa 5",
      monto: expect.stringContaining("1.220"),
      estado: "Rechazado",
      enlaceDgi: "https://www.efactura.dgi.gub.uy/consultaQR/cfe?x",
    });
    expect(filaComprobante(COMPROBANTE).fecha).toContain("11:05");
  });

  it("pedido para retirar, e-Ticket y un enlace que no es https", () => {
    const f = filaComprobante({
      ...COMPROBANTE,
      mesa: null,
      tipoCfe: "101",
      urlConsulta: "javascript:alert(1)",
    });
    expect(f).toMatchObject({
      origen: "Para retirar",
      tipo: "e-Ticket",
      enlaceDgi: null,
    });
  });
});
