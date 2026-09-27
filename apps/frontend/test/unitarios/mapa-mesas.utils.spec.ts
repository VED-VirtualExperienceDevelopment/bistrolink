import {
  aGuardarLayoutItems,
  aplicarEstadoMesa,
  COLOR_POR_ESTADO,
  DIMENSION_MINIMA_MESA,
  dimensionesTrasTransformar,
  mesasConLayoutAEdicion,
  normalizarRotacion,
  nuevaMesaEnEdicion,
  numerosDuplicados,
  parsearNumeroMesa,
  posicionGridPorDefecto,
  puedeEditarMapa,
  siguienteNumeroDisponible,
  type MesaEnEdicion,
} from "@/components/admin/mesas/mapa-mesas.utils";
import {
  ESTADOS_MESA_VALIDOS,
  type GuardarLayoutPayload,
  type MesaConLayout,
} from "@/types/mesa";

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

// ---------------------------------------------------------------------------
// HU-016: casos agregados — serialización ida y vuelta (DoD [T]), valores
// límite contra las reglas del backend (MesaLayoutDto) y la lógica extraída
// de MapaMesasEditor / MesaShape.
// ---------------------------------------------------------------------------

describe("HU-016: serializa y deserializa el layout sin pérdida de datos (GET → editor → POST)", () => {
  // Valores elegidos para detectar pérdidas típicas: decimales, negativos,
  // rotaciones extremas y las 3 formas.
  const respuestaGet: MesaConLayout[] = [
    {
      id: "mesa-1",
      numero: 1,
      estado: "LIBRE",
      layout: { x: 12.75, y: -3.5, forma: "CIRCULO", ancho: 80, alto: 80, rotacion: 0 },
    },
    {
      id: "mesa-2",
      numero: 2,
      estado: "OCUPADA",
      layout: { x: 0, y: 0, forma: "CUADRADO", ancho: 20, alto: 20, rotacion: 359 },
    },
    {
      id: "mesa-3",
      numero: 3,
      estado: "EN_PROCESO_DE_PAGO",
      layout: { x: 1024.125, y: 768.5, forma: "RECTANGULO", ancho: 160.5, alto: 60, rotacion: 45 },
    },
  ];

  it("el body de POST /mesas/layout conserva id, número y los 6 campos de layout de cada mesa", () => {
    // Simula el viaje real: JSON de la API → estado del editor → body JSON.
    const desdeApi: MesaConLayout[] = JSON.parse(JSON.stringify(respuestaGet));
    const payload: GuardarLayoutPayload = {
      restauranteId: "restaurante-1",
      mesas: aGuardarLayoutItems(mesasConLayoutAEdicion(desdeApi)),
    };
    const bodyEnviado: GuardarLayoutPayload = JSON.parse(JSON.stringify(payload));

    expect(bodyEnviado.mesas).toStrictEqual(
      respuestaGet.map(({ id, numero, layout }) => ({ id, numero, ...layout })),
    );
  });

  it("respeta el orden de las mesas en todo el recorrido", () => {
    const items = aGuardarLayoutItems(mesasConLayoutAEdicion(respuestaGet));
    expect(items.map((m) => m.numero)).toEqual([1, 2, 3]);
  });

  it("no reenvía al backend claves extra que vinieran dentro del layout guardado", () => {
    const conClaveExtra = [
      {
        ...respuestaGet[0],
        layout: { ...respuestaGet[0].layout!, onClick: "alert(1)" },
      },
    ] as unknown as MesaConLayout[];

    const [item] = aGuardarLayoutItems(mesasConLayoutAEdicion(conClaveExtra));
    expect(Object.keys(item).sort()).toEqual(
      ["alto", "ancho", "forma", "id", "numero", "rotacion", "x", "y"],
    );
  });
});

describe("mesasConLayoutAEdicion — casos adicionales", () => {
  it("conserva el estado de una mesa sin layout y le asigna la posición de grilla según su índice", () => {
    const mesas: MesaConLayout[] = [
      {
        id: "mesa-1",
        numero: 1,
        estado: "LIBRE",
        layout: { x: 10, y: 10, forma: "CIRCULO", ancho: 80, alto: 80, rotacion: 0 },
      },
      { id: "mesa-2", numero: 2, estado: "OCUPADA", layout: null },
    ];

    const [, sinLayout] = mesasConLayoutAEdicion(mesas);
    expect(sinLayout.estado).toBe("OCUPADA");
    expect({ x: sinLayout.x, y: sinLayout.y }).toEqual(posicionGridPorDefecto(1));
  });

  it("devuelve un array vacío si el restaurante no tiene mesas", () => {
    expect(mesasConLayoutAEdicion([])).toEqual([]);
  });
});

describe("aGuardarLayoutItems — casos adicionales", () => {
  it("en un guardado mixto manda id solo en las mesas ya persistidas", () => {
    const base: MesaEnEdicion = {
      clientId: "x",
      numero: 1,
      estado: "LIBRE",
      x: 0,
      y: 0,
      forma: "CIRCULO",
      ancho: 80,
      alto: 80,
      rotacion: 0,
    };
    const items = aGuardarLayoutItems([
      { ...base, clientId: "mesa-1", id: "mesa-1", numero: 1 },
      { ...base, clientId: "nueva-abc", numero: 2 },
    ]);

    expect(items.map((m) => "id" in m)).toEqual([true, false]);
  });
});

describe("normalizarRotacion — valores límite (backend: @Min(0) @Max(359))", () => {
  it.each([
    [359, 359],
    [360, 0],
    [359.4, 359],
    [359.5, 0],
    [-0.4, 0],
    [-1, 359],
  ])("normaliza %p a %p", (entrada, esperado) => {
    expect(normalizarRotacion(entrada)).toBe(esperado);
  });

  it("siempre devuelve un entero dentro de [0, 359] (nunca -0 ni 360)", () => {
    for (let grados = -1080; grados <= 1080; grados += 0.25) {
      const r = normalizarRotacion(grados);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(359);
      expect(Object.is(r, -0)).toBe(false);
    }
  });
});

describe("siguienteNumeroDisponible — casos adicionales", () => {
  it("no depende del orden ni de números repetidos", () => {
    expect(siguienteNumeroDisponible([{ numero: 3 }, { numero: 1 }, { numero: 1 }])).toBe(2);
  });

  it("nunca sugiere 0 (reservado a la mesa virtual)", () => {
    expect(siguienteNumeroDisponible([{ numero: 0 }])).toBe(1);
  });
});

describe("numerosDuplicados — casos adicionales", () => {
  it("reporta una sola vez un número que aparece tres veces", () => {
    expect(numerosDuplicados([{ numero: 4 }, { numero: 4 }, { numero: 4 }])).toEqual([4]);
  });
});

describe("posicionGridPorDefecto — casos adicionales", () => {
  it("la quinta mesa (índice 4) queda en la última columna de la primera fila", () => {
    expect(posicionGridPorDefecto(4)).toEqual({ x: 560, y: 80 });
  });
});

describe("COLOR_POR_ESTADO", () => {
  it("tiene un color para cada estado de mesa (ninguna mesa se dibuja sin relleno)", () => {
    for (const estado of ESTADOS_MESA_VALIDOS) {
      expect(COLOR_POR_ESTADO[estado]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("puedeEditarMapa (checklist BL-160: solo ADMIN edita)", () => {
  const hasRoleDe = (roles: string[]) => (rol: string) => roles.includes(rol);

  it("ADMIN puede editar", () => {
    expect(puedeEditarMapa(hasRoleDe(["ADMIN"]))).toBe(true);
  });

  it("MOZO (Colaborador) ve el mapa en solo lectura", () => {
    expect(puedeEditarMapa(hasRoleDe(["MOZO"]))).toBe(false);
  });

  it("COCINA o sin roles tampoco pueden editar", () => {
    expect(puedeEditarMapa(hasRoleDe(["COCINA"]))).toBe(false);
    expect(puedeEditarMapa(hasRoleDe([]))).toBe(false);
  });

  it("MOZO que además es ADMIN puede editar", () => {
    expect(puedeEditarMapa(hasRoleDe(["MOZO", "ADMIN"]))).toBe(true);
  });
});

describe("parsearNumeroMesa (edición del número con doble clic)", () => {
  it.each([
    ["1", 1],
    ["12", 12],
    [" 7 ", 7],
  ])("acepta %p como %p", (valor, esperado) => {
    expect(parsearNumeroMesa(valor)).toBe(esperado);
  });

  it.each(["0", "-3", "", "abc"])("rechaza %p (devuelve null)", (valor) => {
    expect(parsearNumeroMesa(valor)).toBeNull();
  });

  it("trunca un decimal a su parte entera (comportamiento de parseInt)", () => {
    expect(parsearNumeroMesa("4.9")).toBe(4);
  });
});

describe("dimensionesTrasTransformar (resize con el Transformer)", () => {
  it("aplica la escala de Konva a ancho y alto", () => {
    expect(dimensionesTrasTransformar(80, 60, 1.5, 2)).toEqual({ ancho: 120, alto: 120 });
  });

  it("no baja del mínimo al achicar", () => {
    expect(dimensionesTrasTransformar(80, 80, 0.1, 0.1)).toEqual({
      ancho: DIMENSION_MINIMA_MESA,
      alto: DIMENSION_MINIMA_MESA,
    });
  });

  it("el mínimo queda por encima de lo que exige el backend (@Min(1))", () => {
    expect(DIMENSION_MINIMA_MESA).toBeGreaterThanOrEqual(1);
  });
});

describe("aplicarEstadoMesa (evento WS mesa:estado_actualizado)", () => {
  const mesas: MesaEnEdicion[] = [
    { clientId: "mesa-1", id: "mesa-1", numero: 1, estado: "LIBRE", x: 10, y: 10, forma: "CIRCULO", ancho: 80, alto: 80, rotacion: 0 },
    { clientId: "mesa-2", id: "mesa-2", numero: 2, estado: "LIBRE", x: 20, y: 20, forma: "CUADRADO", ancho: 80, alto: 80, rotacion: 0 },
    { clientId: "nueva-abc", numero: 3, estado: "LIBRE", x: 30, y: 30, forma: "CIRCULO", ancho: 80, alto: 80, rotacion: 0 },
  ];

  it("cambia solo el estado de la mesa indicada, sin tocar su layout", () => {
    const resultado = aplicarEstadoMesa(mesas, { mesaId: "mesa-2", estado: "OCUPADA" });

    expect(resultado[1]).toEqual({ ...mesas[1], estado: "OCUPADA" });
    expect(resultado[0]).toBe(mesas[0]);
    expect(resultado[2]).toBe(mesas[2]);
  });

  it("ignora un evento de una mesa que no está en el mapa (otro restaurante del tenant)", () => {
    expect(aplicarEstadoMesa(mesas, { mesaId: "mesa-de-otro-restaurante", estado: "OCUPADA" })).toEqual(mesas);
  });

  it("no modifica el array original", () => {
    aplicarEstadoMesa(mesas, { mesaId: "mesa-1", estado: "OCUPADA" });
    expect(mesas[0].estado).toBe("LIBRE");
  });
});
