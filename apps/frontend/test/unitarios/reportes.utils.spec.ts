import {
  CANALES,
  MENSAJE_PLATOS_POS,
  crearRefrescoDiferido,
  filtrosIniciales,
  formatearHora,
  formatearMonto,
  formatearPorcentaje,
  formatearRotacion,
  haceCuanto,
  horaPico,
  horasDelGrafico,
  largoBarra,
  partesPorLugar,
  platosSegun,
  rangoInvalido,
  rutaReportes,
  textoPropinas,
  variacion,
  type FiltrosReportes,
  type ReporteVentas,
} from "@/components/admin/reportes/reportes.utils";

// HU-012 (BL-108): lógica del dashboard de reportes del administrador.

const FILTROS: FiltrosReportes = {
  periodo: "HOY",
  canal: "TODOS",
  desde: "2026-11-03",
  hasta: "2026-11-03",
};

describe("reportes.utils", () => {
  it("[TC-U-312] al abrir: hoy en Uruguay y todos los canales", () => {
    // 3 de noviembre, 01:00 en UTC = 2 de noviembre en Montevideo.
    expect(filtrosIniciales(new Date("2026-11-03T01:00:00.000Z"))).toEqual({
      periodo: "HOY",
      canal: "TODOS",
      desde: "2026-11-02",
      hasta: "2026-11-02",
    });
  });

  it("[TC-U-313] la ruta lleva período y canal; las fechas solo con el personalizado", () => {
    expect(rutaReportes(FILTROS)).toBe(
      "/admin/reportes?periodo=HOY&canal=TODOS",
    );
    expect(
      rutaReportes({
        ...FILTROS,
        periodo: "PERSONALIZADO",
        canal: "LOCAL",
        desde: "2026-10-01",
        hasta: "2026-10-31",
      }),
    ).toBe(
      "/admin/reportes?periodo=PERSONALIZADO&canal=LOCAL&desde=2026-10-01&hasta=2026-10-31",
    );
  });

  it("[TC-U-314] rango inválido: solo el personalizado sin fechas o con desde posterior a hasta", () => {
    expect(rangoInvalido(FILTROS)).toBe(false);
    expect(
      rangoInvalido({ ...FILTROS, periodo: "PERSONALIZADO", desde: "" }),
    ).toBe(true);
    expect(
      rangoInvalido({
        ...FILTROS,
        periodo: "PERSONALIZADO",
        desde: "2026-11-04",
      }),
    ).toBe(true);
    expect(rangoInvalido({ ...FILTROS, periodo: "PERSONALIZADO" })).toBe(false);
  });

  it("[TC-U-315] variación contra el período anterior, con el texto de la comparación", () => {
    expect(variacion(1120, 1000, "HOY")).toEqual({
      sentido: "sube",
      texto: "+12 % vs. ayer",
    });
    expect(variacion(750, 1000, "ULTIMOS_7_DIAS")).toEqual({
      sentido: "baja",
      texto: "−25 % vs. los 7 días anteriores",
    });
    expect(variacion(500, 500, "AYER")).toEqual({
      sentido: "igual",
      texto: "Sin cambios vs. anteayer",
    });
    expect(variacion(500, 0, "MES_ACTUAL")).toEqual({
      sentido: "sube",
      texto: "Sin ventas para comparar vs. los mismos días anteriores",
    });
  });

  it("[TC-U-316] el gráfico por hora va de la primera a la última hora con ventas, sin huecos", () => {
    expect(horasDelGrafico([])).toEqual([]);
    expect(
      horasDelGrafico([
        { hora: 21, monto: 900, pedidos: 3, propina: 90 },
        { hora: 19, monto: 400, pedidos: 1, propina: 0 },
      ]),
    ).toEqual([
      { hora: 19, monto: 400, pedidos: 1, propina: 0 },
      { hora: 20, monto: 0, pedidos: 0, propina: 0 },
      { hora: 21, monto: 900, pedidos: 3, propina: 90 },
    ]);
    expect(formatearHora(21)).toBe("21 h");
  });

  it("[TC-U-317] la hora pico según la métrica elegida; sin ventas, ninguna", () => {
    const horas = [
      { hora: 12, monto: 3000, pedidos: 2, propina: 300 },
      { hora: 21, monto: 2000, pedidos: 5, propina: 0 },
    ];
    expect(horaPico(horas, "monto")?.hora).toBe(12);
    expect(horaPico(horas, "pedidos")?.hora).toBe(21);
    expect(
      horaPico([{ hora: 9, monto: 0, pedidos: 0, propina: 0 }], "monto"),
    ).toBeNull();
  });

  it("[TC-U-318] largo de las barras: proporcional, con un mínimo visible", () => {
    expect(largoBarra(50, 200)).toBe(25);
    expect(largoBarra(1, 1000)).toBe(2);
    expect(largoBarra(0, 1000)).toBe(0);
    expect(largoBarra(10, 0)).toBe(0);
  });

  it("[TC-U-319] ventas dentro y fuera del local con su porcentaje", () => {
    expect(partesPorLugar({ local: 750, web: 250, whatsapp: 0 })).toEqual([
      { clave: "local", etiqueta: "En el local", monto: 750, porcentaje: 75 },
      { clave: "web", etiqueta: "Web", monto: 250, porcentaje: 25 },
      { clave: "whatsapp", etiqueta: "WhatsApp", monto: 0, porcentaje: 0 },
      // Un backend anterior a BL-489 no trae `pos`: cuenta como 0.
      { clave: "pos", etiqueta: "POS del local", monto: 0, porcentaje: 0 },
    ]);
    expect(
      partesPorLugar({ local: 0, web: 0, whatsapp: 0, pos: 0 }).map(
        (p) => p.porcentaje,
      ),
    ).toEqual([0, 0, 0, 0]);
  });

  it("[TC-U-465] HU-011 (BL-489): el POS del local suma al total y es un canal del filtro", () => {
    expect(
      partesPorLugar({ local: 500, web: 250, whatsapp: 0, pos: 250 }).map(
        (p) => [p.clave, p.porcentaje],
      ),
    ).toEqual([
      ["local", 50],
      ["web", 25],
      ["whatsapp", 0],
      ["pos", 25],
    ]);
    expect(CANALES.find((c) => c.valor === "POS")).toMatchObject({
      etiqueta: "POS del local",
    });
    expect(MENSAJE_PLATOS_POS).toMatch(/no informa los platos/);
  });

  it("[TC-U-320] el ranking de platos según cantidad o recaudado", () => {
    const porCantidad = [
      { itemCartaId: "a", nombre: "Agua", cantidad: 9, recaudado: 900 },
    ];
    const porRecaudado = [
      { itemCartaId: "b", nombre: "Bife", cantidad: 2, recaudado: 1200 },
    ];
    const reporte = {
      platosMasPedidos: { porCantidad, porRecaudado },
    } as unknown as ReporteVentas;

    expect(platosSegun(reporte, "cantidad")).toBe(porCantidad);
    expect(platosSegun(reporte, "recaudado")).toBe(porRecaudado);
  });

  it("[TC-U-321] hace cuánto se actualizó, en segundos o minutos", () => {
    const desde = new Date("2026-11-03T12:00:00.000Z");
    expect(haceCuanto(desde, new Date("2026-11-03T12:00:12.000Z"))).toBe(
      "hace 12 s",
    );
    expect(haceCuanto(desde, new Date("2026-11-03T12:03:30.000Z"))).toBe(
      "hace 3 min",
    );
  });

  it("[TC-U-322] una ráfaga de eventos pide los datos una sola vez, 2 s después del último", () => {
    jest.useFakeTimers();
    const accion = jest.fn();
    const refresco = crearRefrescoDiferido(accion);

    refresco.programar();
    jest.advanceTimersByTime(1500);
    refresco.programar();
    jest.advanceTimersByTime(1500);
    expect(accion).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(accion).toHaveBeenCalledTimes(1);

    refresco.programar();
    refresco.cancelar();
    jest.advanceTimersByTime(5000);
    expect(accion).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("[TC-U-323] montos en pesos, rotación con un decimal y WhatsApp como «Próximamente»", () => {
    expect(formatearMonto(48320)).toMatch(/48\.320/);
    expect(formatearMonto(590.5)).toMatch(/590,50/);
    expect(formatearRotacion(2.4)).toBe("2,4");
    expect(formatearRotacion(3)).toBe("3");
    expect(CANALES.filter((c) => c.proximamente).map((c) => c.valor)).toEqual([
      "WHATSAPP",
    ]);
  });

  describe("HU-022 (BL-496): propinas", () => {
    it("el porcentaje va con coma y un decimal solo si hace falta", () => {
      expect(formatearPorcentaje(8.1)).toBe("8,1");
      expect(formatearPorcentaje(10)).toBe("10");
      expect(formatearPorcentaje(0)).toBe("0");
    });

    it("cuántos pedidos dejaron propina y a cuánto equivale sobre las ventas", () => {
      expect(
        textoPropinas(
          { total: 3890, pedidosConPropina: 41, porcentajeDeVentas: 8.1 },
          74,
        ),
      ).toEqual({
        detalle: "41 de 74 pedidos dejaron propina",
        equivalencia: "equivale al 8,1 % de las ventas",
      });
    });

    it("con un solo pedido, el texto va en singular", () => {
      expect(
        textoPropinas(
          { total: 100, pedidosConPropina: 1, porcentajeDeVentas: 10 },
          1,
        ),
      ).toEqual({
        detalle: "1 de 1 pedido dejó propina",
        equivalencia: "equivale al 10 % de las ventas",
      });
    });

    it("sin propinas: lo dice y no muestra equivalencia", () => {
      expect(
        textoPropinas(
          { total: 0, pedidosConPropina: 0, porcentajeDeVentas: 0 },
          12,
        ),
      ).toEqual({
        detalle: "Nadie dejó propina en este período",
        equivalencia: null,
      });
    });

    it("los pedidos con propina se acotan a los pedidos del período (se cuentan por medio de pago)", () => {
      expect(
        textoPropinas(
          { total: 500, pedidosConPropina: 5, porcentajeDeVentas: 12.5 },
          4,
        ).detalle,
      ).toBe("4 de 4 pedidos dejaron propina");
    });
  });
});
