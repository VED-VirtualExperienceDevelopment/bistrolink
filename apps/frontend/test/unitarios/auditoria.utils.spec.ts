import {
  autorDelRegistro,
  cambiosDelRegistro,
  etiquetaAccion,
  fechaParaMostrar,
  FILTROS_AUDITORIA_INICIALES,
  hayFiltrosAuditoria,
  objetoDelRegistro,
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

  it("[TC-U-223] BL-396: las acciones de la carta tienen su texto", () => {
    expect(etiquetaAccion("CARTA_ITEM_ARCHIVADO")).toBe("Ítem archivado");
    expect(etiquetaAccion("CARTA_CATEGORIA_MODIFICADA")).toBe(
      "Categoría modificada",
    );
    expect(
      cambiosDelRegistro({
        valoresAntes: { visible: true, nombre: "Picadas" },
        valoresDespues: { visible: false, nombre: "Tablas" },
      }),
    ).toEqual(["Visible: sí → no", "Nombre: Picadas → Tablas"]);
  });

  it("HU-044 (BL-537): marcar la «Sugerencia del local» se lee con su nombre", () => {
    expect(
      cambiosDelRegistro({
        valoresAntes: { destacado: false },
        valoresDespues: { destacado: true },
      }),
    ).toEqual(["Sugerencia del local: no → sí"]);
  });

  it("[TC-U-224] BL-396: muestra sobre qué ítem o categoría fue la acción", () => {
    expect(objetoDelRegistro({ detalle: { nombre: "Picada Completa" } })).toBe(
      "«Picada Completa»",
    );
    expect(objetoDelRegistro({ detalle: null })).toBeNull();
    expect(objetoDelRegistro({ detalle: { nombre: "  " } })).toBeNull();
    expect(objetoDelRegistro({ detalle: { rol: "MOZO" } })).toBeNull();
  });

  it("la fecha en hora de Uruguay", () => {
    expect(fechaParaMostrar("2026-10-28T00:05:00.000Z")).toMatch(
      /27\/10\/2026.*21:05/,
    );
  });

  it("HU-033 (BL-203): el link de pago generado por el mozo", () => {
    expect(etiquetaAccion("PEDIDO_LINK_PAGO_GENERADO")).toBe(
      "Link de pago generado",
    );
  });

  it("HU-007b (BL-80): el cobro con el POS del local, con tarjeta y autorización", () => {
    expect(etiquetaAccion("PAGO_POS_REGISTRADO")).toBe(
      "Cobro con el POS del local",
    );
    const lineas = cambiosDelRegistro({
      valoresAntes: null,
      valoresDespues: {
        monto: "590.00",
        medio: "Débito",
        autorizacion: "A1B2C3",
      },
    });
    expect(lineas[1]).toMatch(/^Tarjeta: .* → Débito$/);
    expect(lineas[2]).toMatch(/^N\.° de autorización: .* → A1B2C3$/);
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

  it("[TC-U-261] HU-020: la configuración del establecimiento tiene su texto y sus campos legibles", () => {
    expect(etiquetaAccion("ESTABLECIMIENTO_CONFIGURACION_MODIFICADA")).toBe(
      "Configuración del establecimiento modificada",
    );
    expect(
      cambiosDelRegistro({
        valoresAntes: {
          efectivoHabilitado: true,
          propinasSugeridas: [],
          cfeProveedor: "SURTEC",
        },
        valoresDespues: {
          efectivoHabilitado: false,
          propinasSugeridas: [10, 15, 20],
          cfeProveedor: "BILLER",
        },
        detalle: {
          campos: ["efectivoHabilitado", "propinasSugeridas", "cfeProveedor"],
        },
      }),
    ).toEqual([
      "Efectivo: sí → no",
      "Propinas sugeridas (%): — → 10, 15, 20",
      "Proveedor de CFE: Surtec → Biller",
    ]);
  });

  it("[TC-U-262] HU-020: un campo auditado sin el valor (la razón social) se muestra como modificado", () => {
    expect(
      cambiosDelRegistro({
        valoresAntes: { plexoHabilitado: true },
        valoresDespues: { plexoHabilitado: false },
        detalle: { campos: ["razonSocial", "plexoHabilitado"] },
      }),
    ).toEqual(["Plexo: sí → no", "Razón social: modificado"]);
    expect(
      cambiosDelRegistro({
        valoresAntes: null,
        valoresDespues: null,
        detalle: { campos: ["razonSocial", "rut"], origen: "PLATAFORMA" },
      }),
    ).toEqual(["Razón social: modificado", "RUT: modificado"]);
  });

  it("HU-022 (BL-495): la preselección de la propina se ve con su texto, no con el nombre del campo", () => {
    expect(
      cambiosDelRegistro({
        valoresAntes: { propinaPreseleccionada: false },
        valoresDespues: { propinaPreseleccionada: true },
        detalle: { campos: ["propinaPreseleccionada"] },
      }),
    ).toEqual(["Preseleccionar el 10 % de propina: no → sí"]);
  });

  it("HU-022 (BL-495): el cobro en efectivo con propina muestra total, consumo, propina, recibido y vuelto", () => {
    expect(etiquetaAccion("PAGO_EFECTIVO_REGISTRADO")).toBe("Cobro en efectivo");
    expect(
      cambiosDelRegistro({
        valoresAntes: null,
        valoresDespues: {
          monto: "649.00",
          consumo: "590.00",
          propina: "59.00",
          montoRecibido: "1000.00",
          vuelto: "351.00",
        },
      }),
    ).toEqual([
      "Total: — → 649.00",
      "Consumo: — → 590.00",
      "Propina: — → 59.00",
      "Recibido: — → 1000.00",
      "Vuelto: — → 351.00",
    ]);
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

  it("[TC-U-369] HU-015: los ajustes de stock y las ventas sin stock tienen su texto, sus campos y su autor", () => {
    expect(etiquetaAccion("CARTA_ITEM_STOCK_AJUSTADO")).toBe(
      "Stock de un ítem ajustado",
    );
    expect(etiquetaAccion("CARTA_ITEM_VENDIDO_SIN_STOCK")).toBe(
      "Venta sin stock",
    );
    expect(
      cambiosDelRegistro({
        valoresAntes: {
          controlaStock: false,
          stockActual: 0,
          umbralAlerta: 5,
          disponible: true,
        },
        valoresDespues: {
          controlaStock: true,
          stockActual: 12,
          umbralAlerta: 3,
          disponible: true,
        },
      }),
    ).toEqual([
      "Controla stock: no → sí",
      "Unidades: 0 → 12",
      "Aviso con: 5 → 3",
      "Disponible: sí → sí",
    ]);
    expect(
      cambiosDelRegistro({
        valoresAntes: null,
        valoresDespues: null,
        detalle: { nombre: "Flan", pedidoId: "p", unidadesDeMas: 1 },
      }),
    ).toEqual(["Unidades vendidas sin stock: 1"]);
    expect(
      autorDelRegistro({
        usuario: null,
        actorKeycloakId: "sistema:confirmacion-de-pago",
      }),
    ).toBe("Proceso automático");
  });
});
