import {
  actualizarEstadosMesas,
  DEMORA_AVISO_SIN_CONEXION_MS,
  esDesconexionInesperada,
  type MesaEnEdicion,
} from "@/components/admin/mesas/mapa-mesas.utils";

/** BL-331: aviso de conexión en tiempo real perdida en el mapa de mesas. */

function mesa(parcial: Partial<MesaEnEdicion>): MesaEnEdicion {
  return {
    clientId: parcial.id ?? "nueva-1",
    numero: 1,
    estado: "LIBRE",
    x: 100,
    y: 100,
    forma: "CUADRADO",
    ancho: 80,
    alto: 80,
    rotacion: 0,
    ...parcial,
  };
}

describe("esDesconexionInesperada", () => {
  it("un corte de red o del servidor cuenta como pérdida de conexión", () => {
    expect(esDesconexionInesperada("transport close")).toBe(true);
    expect(esDesconexionInesperada("ping timeout")).toBe(true);
    expect(esDesconexionInesperada("io server disconnect")).toBe(true);
  });

  it("cuando la cierra la propia app (salir o renovar el token), no", () => {
    expect(esDesconexionInesperada("io client disconnect")).toBe(false);
  });
});

describe("DEMORA_AVISO_SIN_CONEXION_MS", () => {
  it("muestra el aviso antes de los 5 s que pide el criterio", () => {
    expect(DEMORA_AVISO_SIN_CONEXION_MS).toBeGreaterThan(0);
    expect(DEMORA_AVISO_SIN_CONEXION_MS).toBeLessThan(5000);
  });
});

describe("actualizarEstadosMesas", () => {
  it("actualiza el estado de las mesas que cambiaron mientras no había conexión", () => {
    const mesas = [
      mesa({ id: "a", numero: 1, estado: "LIBRE" }),
      mesa({ id: "b", numero: 2, estado: "LIBRE" }),
    ];
    const resultado = actualizarEstadosMesas(mesas, [
      { id: "a", estado: "OCUPADA" },
      { id: "b", estado: "LIBRE" },
    ]);
    expect(resultado.map((m) => m.estado)).toEqual(["OCUPADA", "LIBRE"]);
  });

  it("no pisa los cambios sin guardar: posición, tamaño, forma y número quedan igual", () => {
    const movida = mesa({
      id: "a",
      numero: 7,
      x: 420,
      y: 310,
      ancho: 120,
      forma: "CIRCULO",
    });
    const [resultado] = actualizarEstadosMesas(
      [movida],
      [{ id: "a", estado: "REQUIERE_LIMPIEZA" }],
    );
    expect(resultado).toEqual({ ...movida, estado: "REQUIERE_LIMPIEZA" });
  });

  it("deja igual las mesas nuevas (sin id) y las que el servidor no devolvió", () => {
    const nueva = mesa({ clientId: "tmp-1", numero: 9 });
    const borradaEnOtroLado = mesa({ id: "x", numero: 3, estado: "OCUPADA" });
    const resultado = actualizarEstadosMesas(
      [nueva, borradaEnOtroLado],
      [{ id: "a", estado: "OCUPADA" }],
    );
    expect(resultado[0]).toBe(nueva);
    expect(resultado[1]).toBe(borradaEnOtroLado);
  });

  it("si no cambió ningún estado, devuelve el mismo array (sin redibujar)", () => {
    const mesas = [mesa({ id: "a", estado: "LIBRE" })];
    expect(actualizarEstadosMesas(mesas, [{ id: "a", estado: "LIBRE" }])).toBe(
      mesas,
    );
  });
});
