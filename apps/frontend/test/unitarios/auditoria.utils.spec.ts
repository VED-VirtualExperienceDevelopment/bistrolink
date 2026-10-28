import {
  autorDelRegistro,
  cambiosDelRegistro,
  etiquetaAccion,
  fechaParaMostrar,
  FILTROS_AUDITORIA_INICIALES,
  hayFiltrosAuditoria,
  rangoInvalido,
  rutaAuditoria,
} from "@/components/admin/auditoria/auditoria.utils";

// HU-035 (BL-205): pantalla de auditoría del administrador.

describe("rutaAuditoria", () => {
  it("sin filtros, la ruta pelada", () => {
    expect(rutaAuditoria(FILTROS_AUDITORIA_INICIALES)).toBe("/auditoria");
  });

  it("las fechas cubren el día completo en hora de Uruguay (UTC-3)", () => {
    const ruta = rutaAuditoria({
      ...FILTROS_AUDITORIA_INICIALES,
      desde: "2026-10-01",
      hasta: "2026-10-27",
    });
    const params = new URLSearchParams(ruta.split("?")[1]);
    expect(params.get("desde")).toBe("2026-10-01T00:00:00.000-03:00");
    expect(params.get("hasta")).toBe("2026-10-27T23:59:59.999-03:00");
  });

  it("incluye usuario, acción y la página desde la 2", () => {
    const ruta = rutaAuditoria(
      { desde: "", hasta: "", usuarioId: "u-1", accion: "USUARIO_CREADO" },
      2,
    );
    expect(ruta).toBe(
      "/auditoria?usuarioId=u-1&accion=USUARIO_CREADO&pagina=2",
    );
  });
});

describe("filtros", () => {
  it("rango inválido solo si «desde» es posterior a «hasta»", () => {
    const base = FILTROS_AUDITORIA_INICIALES;
    expect(
      rangoInvalido({ ...base, desde: "2026-10-28", hasta: "2026-10-27" }),
    ).toBe(true);
    expect(
      rangoInvalido({ ...base, desde: "2026-10-27", hasta: "2026-10-27" }),
    ).toBe(false);
    expect(rangoInvalido({ ...base, desde: "2026-10-28" })).toBe(false);
  });

  it("hay filtros si alguno tiene valor", () => {
    expect(hayFiltrosAuditoria(FILTROS_AUDITORIA_INICIALES)).toBe(false);
    expect(
      hayFiltrosAuditoria({ ...FILTROS_AUDITORIA_INICIALES, accion: "X" }),
    ).toBe(true);
  });
});

describe("cómo se muestra cada registro", () => {
  it("la acción con su texto; una desconocida, tal cual", () => {
    expect(etiquetaAccion("CARTA_ITEM_MODIFICADO")).toBe(
      "Precio o disponibilidad de un ítem",
    );
    expect(etiquetaAccion("ALGO_NUEVO")).toBe("ALGO_NUEVO");
  });

  it("la fecha en hora de Uruguay", () => {
    expect(fechaParaMostrar("2026-10-28T00:05:00.000Z")).toMatch(
      /27\/10\/2026.*21:05/,
    );
  });

  it("los cambios como «campo: antes → después»", () => {
    expect(
      cambiosDelRegistro({
        valoresAntes: { precio: "12.50", disponible: true },
        valoresDespues: { precio: "14.00", disponible: false },
      }),
    ).toEqual(["Precio: 12.50 → 14.00", "Disponible: sí → no"]);
  });

  it("un alta sin valor anterior, campos sin nombre conocido y objetos", () => {
    expect(
      cambiosDelRegistro({
        valoresAntes: null,
        valoresDespues: { rol: "MOZO", extra: { a: 1 }, vacio: "" },
      }),
    ).toEqual(["Rol: — → MOZO", 'extra: — → {"a":1}', "vacio: — → —"]);
    expect(
      cambiosDelRegistro({ valoresAntes: null, valoresDespues: null }),
    ).toEqual([]);
  });

  it("el autor: el usuario del local, un proceso automático o la plataforma", () => {
    expect(
      autorDelRegistro({
        usuario: { id: "u", nombre: "Ana" },
        actorKeycloakId: "k",
      }),
    ).toBe("Ana");
    expect(
      autorDelRegistro({ usuario: null, actorKeycloakId: "script:vero" }),
    ).toBe("Proceso automático");
    expect(autorDelRegistro({ usuario: null, actorKeycloakId: "k" })).toBe(
      "Plataforma o usuario eliminado",
    );
  });
});
