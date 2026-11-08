import {
  anchoNecesarioLienzo,
  cambiarForma,
  DIMENSION_MAXIMA_MESA,
  limitarCentro,
  reubicarFueraDelLienzo,
  semiExtension,
  type MesaEnEdicion,
} from "@/components/admin/mesas/mapa-mesas.utils";

// Límites del lienzo del editor de mesas (BL-58): una mesa no puede quedar
// fuera del área visible, ni al arrastrarla ni al cargar un layout viejo.
// También cubre el cambio de forma (círculo, cuadrado, rectángulo).

function mesa(cambios: Partial<MesaEnEdicion> = {}): MesaEnEdicion {
  return {
    clientId: "m1",
    id: "m1",
    numero: 1,
    estado: "LIBRE",
    x: 100,
    y: 100,
    forma: "RECTANGULO",
    ancho: 100,
    alto: 40,
    rotacion: 0,
    ...cambios,
  };
}

const LIENZO = { ancho: 800, alto: 600 };

describe("semiExtension", () => {
  it("círculo: usa ancho/2 como radio en ambos ejes", () => {
    expect(
      semiExtension(mesa({ forma: "CIRCULO", ancho: 80, alto: 10 })),
    ).toEqual({ dx: 40, dy: 40 });
  });

  it("rectángulo sin rotar: mitad del ancho y del alto", () => {
    expect(semiExtension(mesa())).toEqual({ dx: 50, dy: 20 });
  });

  it("rectángulo rotado 90°: intercambia ancho y alto", () => {
    const { dx, dy } = semiExtension(mesa({ rotacion: 90 }));
    expect(dx).toBeCloseTo(20);
    expect(dy).toBeCloseTo(50);
  });

  it("rectángulo rotado 45°: la caja envolvente es más grande que la mesa", () => {
    const { dx, dy } = semiExtension(
      mesa({ ancho: 100, alto: 100, rotacion: 45 }),
    );
    expect(dx).toBeCloseTo(70.71, 1);
    expect(dy).toBeCloseTo(70.71, 1);
  });
});

describe("limitarCentro", () => {
  const extension = { dx: 50, dy: 20 };

  it("no toca una posición que ya está dentro", () => {
    expect(limitarCentro({ x: 300, y: 300 }, extension, LIENZO)).toEqual({
      x: 300,
      y: 300,
    });
  });

  it("acota contra los cuatro bordes", () => {
    expect(limitarCentro({ x: -500, y: -500 }, extension, LIENZO)).toEqual({
      x: 50,
      y: 20,
    });
    expect(limitarCentro({ x: 5000, y: 5000 }, extension, LIENZO)).toEqual({
      x: 750,
      y: 580,
    });
  });

  it("mesa más grande que el lienzo: la centra", () => {
    expect(limitarCentro({ x: 0, y: 0 }, { dx: 500, dy: 400 }, LIENZO)).toEqual(
      { x: 400, y: 300 },
    );
  });
});

describe("anchoNecesarioLienzo", () => {
  it("sin mesas: 0", () => {
    expect(anchoNecesarioLienzo([])).toBe(0);
  });

  it("borde derecho de la mesa más alejada", () => {
    expect(anchoNecesarioLienzo([mesa({ x: 100 }), mesa({ x: 1200 })])).toBe(
      1250,
    );
  });
});

describe("reubicarFueraDelLienzo", () => {
  it("no cambia nada si todas las mesas están dentro", () => {
    const mesas = [mesa(), mesa({ clientId: "m2", x: 700, y: 500 })];
    const resultado = reubicarFueraDelLienzo(mesas, 600);
    expect(resultado.reubicadas).toBe(0);
    expect(resultado.mesas[0]).toBe(mesas[0]);
    expect(resultado.mesas[1]).toBe(mesas[1]);
  });

  it("trae al área visible las mesas con x o y negativas o y mayor al alto", () => {
    const resultado = reubicarFueraDelLienzo(
      [
        mesa({ x: -30 }),
        mesa({ clientId: "m2", y: -10 }),
        mesa({ clientId: "m3", y: 680 }),
      ],
      600,
    );
    expect(resultado.reubicadas).toBe(3);
    expect(resultado.mesas.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 50, y: 100 },
      { x: 100, y: 20 },
      { x: 100, y: 580 },
    ]);
  });

  it("no mueve mesas a la derecha del contenedor (el lienzo se ensancha)", () => {
    const lejos = mesa({ x: 3000 });
    const resultado = reubicarFueraDelLienzo([lejos], 600);
    expect(resultado.reubicadas).toBe(0);
    expect(resultado.mesas[0]).toBe(lejos);
  });
});

describe("cambiarForma", () => {
  it("misma forma: no cambia las dimensiones", () => {
    expect(cambiarForma(mesa({ ancho: 100, alto: 40 }), "RECTANGULO")).toEqual({
      forma: "RECTANGULO",
      ancho: 100,
      alto: 40,
    });
  });

  it("círculo → cuadrado: mismo lado", () => {
    expect(
      cambiarForma(mesa({ forma: "CIRCULO", ancho: 80, alto: 80 }), "CUADRADO"),
    ).toEqual({
      forma: "CUADRADO",
      ancho: 80,
      alto: 80,
    });
  });

  it("cuadrado → rectángulo: se alarga a lo ancho (1,5 veces)", () => {
    expect(
      cambiarForma(
        mesa({ forma: "CUADRADO", ancho: 80, alto: 80 }),
        "RECTANGULO",
      ),
    ).toEqual({
      forma: "RECTANGULO",
      ancho: 120,
      alto: 80,
    });
  });

  it("rectángulo → círculo: usa el lado corto, para que la mesa no crezca", () => {
    expect(cambiarForma(mesa({ ancho: 120, alto: 60 }), "CIRCULO")).toEqual({
      forma: "CIRCULO",
      ancho: 60,
      alto: 60,
    });
  });

  it("a rectángulo sin pasar el máximo del backend", () => {
    expect(
      cambiarForma(
        mesa({ forma: "CUADRADO", ancho: 900, alto: 900 }),
        "RECTANGULO",
      ),
    ).toEqual({ forma: "RECTANGULO", ancho: DIMENSION_MAXIMA_MESA, alto: 900 });
  });
});
