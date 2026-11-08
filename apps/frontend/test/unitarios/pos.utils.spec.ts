import {
  claseEstadoPos,
  detalleEstado,
  filaSincronizacion,
  FILTROS_ESTADO_POS,
  mensajeReintentoPos,
  rutaReintentarPos,
  rutaSincronizaciones,
  sePuedeReintentar,
  textoIntegracion,
  type SincronizacionPos,
} from "@/components/admin/pos/pos.utils";

// HU-011 (BL-488): pantalla /admin/pos (ventas mandadas al POS del local).

const base: SincronizacionPos = {
  id: "11111111-2222-3333-4444-555555555555",
  tipo: "VENTA",
  estado: "PENDIENTE",
  pedidoId: "a1b2c3d4-0000-0000-0000-000000000000",
  mesa: 4,
  total: 590,
  posRef: null,
  intentos: 0,
  ultimoError: null,
  ultimoIntentoEn: null,
  enviadaEn: null,
  creadaEn: "2026-11-08T15:30:00.000Z",
};

describe("rutas de /admin/pos", () => {
  it("listado: sin filtros, con estado y con página", () => {
    expect(rutaSincronizaciones("")).toBe("/admin/pos/sincronizaciones");
    expect(rutaSincronizaciones("ERROR")).toBe(
      "/admin/pos/sincronizaciones?estado=ERROR",
    );
    expect(rutaSincronizaciones("", 2)).toBe(
      "/admin/pos/sincronizaciones?pagina=2",
    );
  });

  it("reintentar codifica el id", () => {
    expect(rutaReintentarPos("a/b")).toBe(
      "/admin/pos/sincronizaciones/a%2Fb/reintentar",
    );
  });

  it("el filtro tiene «Todas» primero y los cuatro estados", () => {
    expect(FILTROS_ESTADO_POS.map((f) => f.valor)).toEqual([
      "",
      "PENDIENTE",
      "ERROR",
      "ENVIADA",
      "DESCARTADA",
    ]);
  });
});

describe("estado de cada fila", () => {
  it("se reintenta lo pendiente o con error, no lo enviado ni lo descartado", () => {
    expect(sePuedeReintentar(base)).toBe(true);
    expect(sePuedeReintentar({ ...base, estado: "ERROR" })).toBe(true);
    expect(sePuedeReintentar({ ...base, estado: "ENVIADA" })).toBe(false);
    expect(sePuedeReintentar({ ...base, estado: "DESCARTADA" })).toBe(false);
  });

  it("detalle: recién encolada, con intentos, con error, enviada y descartada", () => {
    expect(detalleEstado(base)).toBe("Se manda en unos segundos");
    expect(detalleEstado({ ...base, intentos: 1 })).toBe("1 intento fallido");
    expect(
      detalleEstado({ ...base, intentos: 3, ultimoError: "POS caído" }),
    ).toBe("3 intentos fallidos: POS caído");
    expect(
      detalleEstado({ ...base, estado: "ENVIADA", posRef: "MOCK-1" }),
    ).toBe("Id en el POS: MOCK-1");
    expect(detalleEstado({ ...base, estado: "ENVIADA" })).toBeNull();
    expect(detalleEstado({ ...base, estado: "DESCARTADA" })).toBe(
      "El pedido se canceló antes de mandarse",
    );
  });

  it("clases por estado: el error se destaca", () => {
    expect(claseEstadoPos("ERROR")).toContain("bg-error-container");
    expect(claseEstadoPos("ENVIADA")).toContain("bg-primary-container");
    expect(claseEstadoPos("PENDIENTE")).toContain("rounded-full");
    expect(claseEstadoPos("DESCARTADA")).toContain("bg-surface-container");
  });

  it("fila: fecha en Uruguay, código del pedido, origen, tipo y total", () => {
    const f = filaSincronizacion(base);
    expect(f.fecha).toBe("08/11/2026, 12:30");
    expect(f.pedido).toBe("#A1B2C3");
    expect(f.origen).toBe("Mesa 4");
    expect(f.tipo).toBe("Venta");
    expect(f.estado).toBe("Pendiente");
    expect(f.total).toContain("590");
  });

  it("fila enviada: usa la fecha de envío; para retirar y anulación", () => {
    const f = filaSincronizacion({
      ...base,
      tipo: "ANULACION",
      mesa: null,
      estado: "ENVIADA",
      enviadaEn: "2026-11-08T16:00:00.000Z",
    });
    expect(f.fecha).toBe("08/11/2026, 13:00");
    expect(f.origen).toBe("Para retirar");
    expect(f.tipo).toBe("Anulación");
    expect(f.estado).toBe("En el POS");
  });
});

describe("mensajes", () => {
  it("reintento: enviada, pendiente (se reintenta sola) y error (revisar)", () => {
    expect(
      mensajeReintentoPos({ id: "x", estado: "ENVIADA", ultimoError: null }),
    ).toBe("Listo: ya está en el POS.");
    expect(
      mensajeReintentoPos({
        id: "x",
        estado: "PENDIENTE",
        ultimoError: "El POS no respondió",
      }),
    ).toBe(
      "No se pudo mandar: El POS no respondió. Se vuelve a intentar sola.",
    );
    expect(
      mensajeReintentoPos({ id: "x", estado: "PENDIENTE", ultimoError: null }),
    ).toBe("No se pudo mandar. Se vuelve a intentar sola.");
    expect(
      mensajeReintentoPos({
        id: "x",
        estado: "ERROR",
        ultimoError: "HTTP 422",
      }),
    ).toBe(
      "El POS no la aceptó: HTTP 422. Revisá el motivo antes de reintentar.",
    );
  });

  it("integración: sin POS configurado, activada y desactivada", () => {
    expect(textoIntegracion({ habilitada: true, adaptador: null })).toMatch(
      /no tiene un POS configurado/,
    );
    expect(textoIntegracion({ habilitada: true, adaptador: "mock" })).toMatch(
      /se manda al POS de prueba en segundos/,
    );
    expect(textoIntegracion({ habilitada: false, adaptador: "http" })).toBe(
      "El envío está desactivado: las ventas no se mandan al POS del local.",
    );
  });
});
