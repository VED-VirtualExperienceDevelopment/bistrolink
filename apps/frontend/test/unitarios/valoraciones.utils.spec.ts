import {
  conClaves,
  estrellasDelPromedio,
  filtrosInicialesValoraciones,
  formatearDia,
  formatearPromedio,
  porcentajeDe,
  rutaValoraciones,
  textoCantidad,
  textoComentariosMostrados,
} from "@/components/admin/valoraciones/valoraciones.utils";

/** HU-050 (BL-558): pantalla de valoraciones del Administrador. */
describe("valoraciones del Administrador (HU-050, BL-558)", () => {
  it("[TC-U-588] al abrir: últimos 7 días; la ruta lleva solo el período (y las fechas si es personalizado)", () => {
    const filtros = filtrosInicialesValoraciones(
      new Date("2026-11-16T02:30:00.000Z"),
    );
    expect(filtros).toMatchObject({
      periodo: "ULTIMOS_7_DIAS",
      desde: "2026-11-15",
      hasta: "2026-11-15",
    });
    expect(rutaValoraciones(filtros)).toBe(
      "/admin/valoraciones?periodo=ULTIMOS_7_DIAS",
    );
    expect(
      rutaValoraciones({
        ...filtros,
        periodo: "PERSONALIZADO",
        desde: "2026-11-01",
        hasta: "2026-11-10",
      }),
    ).toBe(
      "/admin/valoraciones?periodo=PERSONALIZADO&desde=2026-11-01&hasta=2026-11-10",
    );
  });

  it("[TC-U-589] promedio con coma decimal, porcentajes y textos", () => {
    expect(formatearPromedio(4.3)).toBe("4,3");
    expect(formatearPromedio(5)).toBe("5,0");
    expect(formatearPromedio(null)).toBe("—");
    expect(porcentajeDe(1, 3)).toBe(33);
    expect(porcentajeDe(0, 0)).toBe(0);
    expect(textoCantidad(1)).toBe("1 valoración");
    expect(textoCantidad(12)).toBe("12 valoraciones");
    expect(formatearDia("2026-11-14")).toBe("14/11/2026");
    expect(estrellasDelPromedio(4.3)).toBe(4);
    expect(estrellasDelPromedio(4.5)).toBe(5);
    expect(estrellasDelPromedio(null)).toBe(0);
  });

  it("avisa solo si hay más comentarios que los que se muestran", () => {
    expect(textoComentariosMostrados(3, 3)).toBeNull();
    expect(textoComentariosMostrados(200, 250)).toBe(
      "Se muestran los 200 más recientes de 250. Elegí un período más corto para ver el resto.",
    );
  });

  it("cada comentario tiene una clave estable, también si se repite el mismo día", () => {
    const c = { dia: "2026-11-15", estrellas: 5, comentario: "Rico" };
    expect(conClaves([c, c]).map((x) => x.clave)).toEqual([
      "2026-11-15|5|Rico|0",
      "2026-11-15|5|Rico|1",
    ]);
  });
});
