import {
  cambiarEstadoMesa,
  contar,
  fechaLarga,
  lugarDelPedido,
  mesasConGente,
  minutosDesde,
  pedidosEnCocina,
  pedidosListos,
  platosAgotados,
  primerNombre,
  resumenSalon,
  saludo,
  saludoSegunHora,
  textoHaceCuanto,
  topPlatos,
} from "@/components/admin/inicio/inicio.utils";
import type { Pedido } from "@/types/pedido";

// BL-520: pantalla de Inicio del administrador y del mozo.

/** Una fecha a la hora dada de Uruguay (UTC−3) el 10/11/2026. */
const aLas = (hora: number, minuto = 0) =>
  new Date(Date.UTC(2026, 10, 10, hora + 3, minuto));

describe("saludoSegunHora (hora de Uruguay)", () => {
  it.each([
    [6, "Buen día"],
    [11, "Buen día"],
    [12, "Buenas tardes"],
    [19, "Buenas tardes"],
    [20, "Buenas noches"],
    [23, "Buenas noches"],
    [2, "Buenas noches"],
  ])("a las %i h dice «%s»", (hora, esperado) => {
    expect(saludoSegunHora(aLas(hora))).toBe(esperado);
  });
});

describe("saludo", () => {
  it("usa solo el primer nombre", () => {
    expect(saludo(aLas(21), "Ana María Pérez")).toBe("Buenas noches, Ana");
  });

  it("sin nombre, saluda sin coma", () => {
    expect(saludo(aLas(9), undefined)).toBe("Buen día");
    expect(saludo(aLas(9), "   ")).toBe("Buen día");
  });
});

describe("primerNombre", () => {
  it("toma la primera palabra", () => {
    expect(primerNombre("  Vero   Couto ")).toBe("Vero");
  });

  it("devuelve null sin nombre", () => {
    expect(primerNombre(undefined)).toBeNull();
  });
});

describe("fechaLarga", () => {
  it("día de la semana con mayúscula, día y mes", () => {
    expect(fechaLarga(aLas(21))).toBe("Martes 10 de noviembre");
  });

  it("usa el día de Uruguay aunque en UTC ya sea el siguiente", () => {
    expect(fechaLarga(aLas(23, 30))).toBe("Martes 10 de noviembre");
  });
});

describe("resumenSalon", () => {
  const mesas = [
    { estado: "LIBRE" as const },
    { estado: "LIBRE" as const },
    { estado: "OCUPADA" as const },
    { estado: "EN_PROCESO_DE_PAGO" as const },
    { estado: "REQUIERE_LIMPIEZA" as const },
  ];

  it("cuenta las mesas de cada estado", () => {
    expect(resumenSalon(mesas)).toEqual({
      libres: 2,
      ocupadas: 1,
      pagando: 1,
      paraLimpiar: 1,
      total: 5,
    });
  });

  it("con gente: ocupadas y pagando", () => {
    expect(mesasConGente(resumenSalon(mesas))).toBe(2);
  });

  it("sin mesas, todo en cero", () => {
    expect(resumenSalon([]).total).toBe(0);
  });
});

describe("cambiarEstadoMesa", () => {
  it("cambia solo la mesa del aviso", () => {
    const mesas = [
      { id: "a", estado: "LIBRE" as const },
      { id: "b", estado: "LIBRE" as const },
    ];
    expect(cambiarEstadoMesa(mesas, "b", "OCUPADA")).toEqual([
      { id: "a", estado: "LIBRE" },
      { id: "b", estado: "OCUPADA" },
    ]);
  });
});

const pedido = (
  id: string,
  estado: Pedido["estado"],
  createdAt: string,
  mesaNumero = 4,
): Pedido => ({
  id,
  estado,
  createdAt,
  mesaNumero,
  lineas: [
    { id: `${id}-1`, nombreSnapshot: "Milanesa", cantidad: 2 },
    { id: `${id}-2`, nombreSnapshot: "Fritas", cantidad: 1 },
  ],
});

describe("pedidosListos", () => {
  const pedidos = [
    pedido("p1", "LISTO_PARA_ENTREGAR", "2026-11-10T23:50:00Z"),
    pedido("p2", "EN_PREPARACION", "2026-11-10T23:40:00Z"),
    pedido("p3", "LISTO_PARA_ENTREGAR", "2026-11-10T23:45:00Z", 0),
  ];

  it("solo los listos, el que más espera primero", () => {
    expect(pedidosListos(pedidos, {}).map((p) => p.id)).toEqual(["p3", "p1"]);
  });

  it("el pedido para retirar (mesa 0) va sin número", () => {
    expect(pedidosListos(pedidos, {})[0].mesaNumero).toBeNull();
  });

  it("usa la hora en que pasó a listo si llegó en vivo", () => {
    const listos = pedidosListos(pedidos, { p1: "2026-11-10T23:30:00Z" });
    expect(listos[0]).toMatchObject({
      id: "p1",
      desde: "2026-11-10T23:30:00Z",
    });
  });

  it("resume los platos", () => {
    expect(pedidosListos(pedidos, {})[0].platos).toBe(
      "2 × Milanesa, 1 × Fritas",
    );
  });
});

describe("lugarDelPedido (HU-040, BL-210)", () => {
  it("mesa con número", () => {
    expect(lugarDelPedido({ mesaNumero: 4, retiro: null })).toBe("Mesa 4");
  });

  it("retiro con código y nombre", () => {
    expect(
      lugarDelPedido({
        mesaNumero: null,
        retiro: { codigo: "R-042", nombre: "Ana" },
      }),
    ).toBe("Retiro R-042 · Ana");
  });

  it("retiro con código y sin nombre", () => {
    expect(
      lugarDelPedido({
        mesaNumero: null,
        retiro: { codigo: "R-042", nombre: null },
      }),
    ).toBe("Retiro R-042");
  });

  it("retiro sin código conocido", () => {
    expect(lugarDelPedido({ mesaNumero: null, retiro: null })).toBe("Retiro");
  });
});

it("pedidosListos trae el código del retiro", () => {
  const conRetiro: Pedido = {
    ...pedido("r1", "LISTO_PARA_ENTREGAR", "2026-11-10T23:00:00Z", 0),
    retiro: { codigo: "R-007", nombre: null },
  };
  expect(pedidosListos([conRetiro], {})[0].retiro).toEqual({
    codigo: "R-007",
    nombre: null,
  });
});

describe("pedidosEnCocina", () => {
  it("cuenta recibidos y en preparación", () => {
    expect(
      pedidosEnCocina([
        pedido("a", "RECIBIDO", "2026-11-10T23:00:00Z"),
        pedido("b", "EN_PREPARACION", "2026-11-10T23:00:00Z"),
        pedido("c", "LISTO_PARA_ENTREGAR", "2026-11-10T23:00:00Z"),
      ]),
    ).toBe(2);
  });
});

describe("minutosDesde y textoHaceCuanto", () => {
  const ahora = Date.parse("2026-11-11T00:10:00Z");

  it("minutos enteros desde una fecha o un timestamp", () => {
    expect(minutosDesde("2026-11-11T00:01:30Z", ahora)).toBe(8);
    expect(minutosDesde(ahora - 3 * 60_000, ahora)).toBe(3);
  });

  it("nunca negativo ni NaN", () => {
    expect(minutosDesde("2026-11-11T00:20:00Z", ahora)).toBe(0);
    expect(minutosDesde("no es fecha", ahora)).toBe(0);
  });

  it.each([
    [0, "recién"],
    [1, "hace 1 min"],
    [59, "hace 59 min"],
    [60, "hace 1 h"],
    [65, "hace 1 h 5 min"],
  ])("%i min → «%s»", (minutos, esperado) => {
    expect(textoHaceCuanto(minutos)).toBe(esperado);
  });
});

describe("platosAgotados", () => {
  it("los no disponibles de categorías activas, ordenados y sin repetir", () => {
    expect(
      platosAgotados([
        {
          id: "c1",
          nombre: "Postres",
          items: [
            { id: "1", nombre: "Flan", precio: 200, disponible: false },
            { id: "2", nombre: "Helado", precio: 200, disponible: true },
          ],
        },
        {
          id: "c2",
          nombre: "Minutas",
          items: [
            { id: "3", nombre: "Chivito", precio: 600, disponible: false },
            { id: "4", nombre: "Flan", precio: 200, disponible: false },
          ],
        },
        {
          id: "c3",
          nombre: "Archivada",
          activo: false,
          items: [{ id: "5", nombre: "Viejo", precio: 1, disponible: false }],
        },
      ]),
    ).toEqual(["Chivito", "Flan"]);
  });
});

describe("topPlatos y contar", () => {
  it("los primeros tres", () => {
    const platos = [1, 2, 3, 4].map((n) => ({
      itemCartaId: `${n}`,
      nombre: `Plato ${n}`,
      cantidad: 10 - n,
      recaudado: 0,
    }));
    expect(topPlatos(platos).map((p) => p.itemCartaId)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("singular y plural", () => {
    expect(contar(1, "mesa", "mesas")).toBe("1 mesa");
    expect(contar(3, "mesa", "mesas")).toBe("3 mesas");
  });
});
