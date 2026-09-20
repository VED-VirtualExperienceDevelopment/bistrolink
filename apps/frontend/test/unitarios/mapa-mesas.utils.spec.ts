import {
  aGuardarLayoutItems,
  mesasConLayoutAEdicion,
  normalizarRotacion,
  nuevaMesaEnEdicion,
  numerosDuplicados,
  posicionGridPorDefecto,
  siguienteNumeroDisponible,
  type MesaEnEdicion,
} from "@/components/admin/mesas/mapa-mesas.utils";
import type { MesaConLayout } from "@/types/mesa";

describe("normalizarRotacion", () => {
  it("deja igual un ángulo ya dentro de [0, 359]", () => {
    expect(normalizarRotacion(45)).toBe(45);
    expect(normalizarRotacion(0)).toBe(0);
  });

  it("envuelve un ángulo negativo (rotación en sentido antihorario)", () => {
    expect(normalizarRotacion(-10)).toBe(350);
    expect(normalizarRotacion(-370)).toBe(350);
  });

  it("envuelve un ángulo mayor a 360 (varias vueltas acumuladas)", () => {
    expect(normalizarRotacion(370)).toBe(10);
    expect(normalizarRotacion(720)).toBe(0);
  });

  it("redondea decimales antes de envolver", () => {
    expect(normalizarRotacion(45.6)).toBe(46);
  });
});

describe("siguienteNumeroDisponible", () => {
  it("devuelve 1 si no hay mesas", () => {
    expect(siguienteNumeroDisponible([])).toBe(1);
  });

  it("devuelve el primer numero libre, no solo max+1", () => {
    expect(siguienteNumeroDisponible([{ numero: 1 }, { numero: 3 }])).toBe(2);
  });

  it("devuelve max+1 cuando no hay huecos", () => {
    expect(siguienteNumeroDisponible([{ numero: 1 }, { numero: 2 }])).toBe(3);
  });
});

describe("numerosDuplicados", () => {
  it("no reporta nada si todos los numeros son unicos", () => {
    expect(numerosDuplicados([{ numero: 1 }, { numero: 2 }])).toEqual([]);
  });

  it("reporta los numeros que se repiten (el backend los rechazaria con 409)", () => {
    expect(
      numerosDuplicados([
        { numero: 1 },
        { numero: 2 },
        { numero: 1 },
        { numero: 3 },
        { numero: 3 },
      ]),
    ).toEqual([1, 3]);
  });
});

describe("posicionGridPorDefecto", () => {
  it("ubica la primera mesa en el offset base", () => {
    expect(posicionGridPorDefecto(0)).toEqual({ x: 80, y: 80 });
  });

  it("arranca una nueva fila al llegar a la columna 5", () => {
    expect(posicionGridPorDefecto(5)).toEqual({ x: 80, y: 200 });
  });
});

describe("nuevaMesaEnEdicion", () => {
  it("arma una mesa LIBRE con layout por defecto (circulo)", () => {
    const mesa = nuevaMesaEnEdicion("nueva-1", 7, 0);
    expect(mesa).toEqual({
      clientId: "nueva-1",
      numero: 7,
      estado: "LIBRE",
      x: 80,
      y: 80,
      forma: "CIRCULO",
      ancho: 80,
      alto: 80,
      rotacion: 0,
    });
  });
});

describe("mesasConLayoutAEdicion", () => {
  it("usa el layout existente cuando la mesa ya tiene uno", () => {
    const mesas: MesaConLayout[] = [
      {
        id: "mesa-1",
        numero: 3,
        estado: "OCUPADA",
        layout: {
          x: 10,
          y: 20,
          forma: "RECTANGULO",
          ancho: 100,
          alto: 60,
          rotacion: 90,
        },
      },
    ];

    expect(mesasConLayoutAEdicion(mesas)).toEqual([
      {
        clientId: "mesa-1",
        id: "mesa-1",
        numero: 3,
        estado: "OCUPADA",
        x: 10,
        y: 20,
        forma: "RECTANGULO",
        ancho: 100,
        alto: 60,
        rotacion: 90,
      },
    ]);
  });

  it("asigna una posicion de grilla y forma por defecto a una mesa sin layout todavia", () => {
    const mesas: MesaConLayout[] = [
      { id: "mesa-1", numero: 1, estado: "LIBRE", layout: null },
    ];

    const [mesa] = mesasConLayoutAEdicion(mesas);
    expect(mesa.clientId).toBe("mesa-1");
    expect(mesa.forma).toBe("CIRCULO");
    expect(mesa.x).toBe(80);
    expect(mesa.y).toBe(80);
  });
});

describe("aGuardarLayoutItems", () => {
  const base: MesaEnEdicion = {
    clientId: "x",
    numero: 1,
    estado: "LIBRE",
    x: 10,
    y: 20,
    forma: "CIRCULO",
    ancho: 80,
    alto: 80,
    rotacion: 0,
  };

  it("incluye el id cuando la mesa ya existe", () => {
    const [item] = aGuardarLayoutItems([{ ...base, id: "mesa-1" }]);
    expect(item).toEqual({
      id: "mesa-1",
      numero: 1,
      x: 10,
      y: 20,
      forma: "CIRCULO",
      ancho: 80,
      alto: 80,
      rotacion: 0,
    });
  });

  it("omite el id para una mesa nueva (sin persistir)", () => {
    const [item] = aGuardarLayoutItems([base]);
    expect(item.id).toBeUndefined();
    expect("id" in item).toBe(false);
  });

  it("no manda clientId ni estado al backend", () => {
    const [item] = aGuardarLayoutItems([base]);
    expect(item).not.toHaveProperty("clientId");
    expect(item).not.toHaveProperty("estado");
  });
});
