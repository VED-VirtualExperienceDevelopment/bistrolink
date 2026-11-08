import {
  idsAEliminar,
  puedeEliminarMesa,
  quitarMesa,
  type MesaEnEdicion,
} from "@/components/admin/mesas/mapa-mesas.utils";

// BL-58: "Eliminar mesa" en el editor del mapa. Las mesas nuevas (sin id)
// desaparecen sin más; las guardadas se acumulan en `eliminadas` para
// mandarlas en el próximo POST /mesas/layout. Solo se quitan mesas LIBRES.

function mesa(cambios: Partial<MesaEnEdicion> = {}): MesaEnEdicion {
  return {
    clientId: "m1",
    id: "m1",
    numero: 1,
    estado: "LIBRE",
    x: 100,
    y: 100,
    forma: "CIRCULO",
    ancho: 80,
    alto: 80,
    rotacion: 0,
    ...cambios,
  };
}

describe("puedeEliminarMesa", () => {
  it("permite eliminar una mesa libre", () => {
    expect(puedeEliminarMesa(mesa())).toBe(true);
  });

  it.each(["OCUPADA", "EN_PROCESO_DE_PAGO"] as const)(
    "no permite eliminar una mesa %s",
    (estado) => {
      expect(puedeEliminarMesa(mesa({ estado }))).toBe(false);
    },
  );
});

describe("quitarMesa", () => {
  it("mesa guardada: la saca del mapa y la agrega a eliminadas", () => {
    const guardada = mesa({ clientId: "a", id: "a" });
    const otra = mesa({ clientId: "b", id: "b", numero: 2 });
    const resultado = quitarMesa([guardada, otra], [], "a");
    expect(resultado.mesas).toEqual([otra]);
    expect(resultado.eliminadas).toEqual([guardada]);
  });

  it("mesa nueva (sin id): la saca del mapa y no la agrega a eliminadas", () => {
    const nueva = mesa({ clientId: "nueva-1", id: undefined });
    const resultado = quitarMesa([nueva], [], "nueva-1");
    expect(resultado.mesas).toEqual([]);
    expect(resultado.eliminadas).toEqual([]);
  });

  it("acumula sobre las eliminadas anteriores", () => {
    const previa = mesa({ clientId: "a", id: "a" });
    const guardada = mesa({ clientId: "b", id: "b", numero: 2 });
    expect(quitarMesa([guardada], [previa], "b").eliminadas).toEqual([
      previa,
      guardada,
    ]);
  });

  it("mesa ocupada: no cambia nada", () => {
    const ocupada = mesa({ estado: "OCUPADA" });
    const mesas = [ocupada];
    const eliminadas: MesaEnEdicion[] = [];
    const resultado = quitarMesa(mesas, eliminadas, "m1");
    expect(resultado.mesas).toBe(mesas);
    expect(resultado.eliminadas).toBe(eliminadas);
  });

  it("clientId inexistente: no cambia nada", () => {
    const mesas = [mesa()];
    expect(quitarMesa(mesas, [], "no-existe").mesas).toBe(mesas);
  });
});

describe("idsAEliminar", () => {
  it("devuelve los ids de las mesas eliminadas", () => {
    expect(idsAEliminar([mesa({ id: "a" }), mesa({ id: "b" })])).toEqual([
      "a",
      "b",
    ]);
  });

  it("ignora mesas sin id", () => {
    expect(idsAEliminar([mesa({ id: undefined })])).toEqual([]);
  });
});
