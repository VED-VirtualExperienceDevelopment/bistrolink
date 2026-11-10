import {
  ANCHO_MINIMO_TARJETA,
  comandasDelMonitor,
  densidadMonitor,
  resumenMonitor,
  textoEnPreparacion,
  textoOcultas,
} from "@/components/kds/monitor-cocina.utils";
import type { Pedido } from "@/types/pedido";

// HU-038 (BL-510): monitor de Cocina.

function pedido(id: string, estado: Pedido["estado"], hora: string): Pedido {
  return {
    id,
    estado,
    mesaNumero: 1,
    createdAt: `2026-11-10T${hora}:00.000Z`,
    lineas: [],
  } as unknown as Pedido;
}

const PEDIDOS = [
  pedido("listo-viejo", "LISTO_PARA_ENTREGAR", "12:00"),
  pedido("prep-nuevo", "EN_PREPARACION", "12:20"),
  pedido("recibido", "RECIBIDO", "12:05"),
  pedido("prep-viejo", "EN_PREPARACION", "12:10"),
  pedido("listo-nuevo", "LISTO_PARA_ENTREGAR", "12:15"),
  pedido("entregado", "ENTREGADO", "11:00"),
];

describe("comandasDelMonitor", () => {
  it("[TC-U-492] solo en preparación y listos: primero en preparación, cada estado de la más vieja a la más nueva", () => {
    expect(comandasDelMonitor(PEDIDOS).map((p) => p.id)).toEqual([
      "prep-viejo",
      "prep-nuevo",
      "listo-viejo",
      "listo-nuevo",
    ]);
  });

  it("[TC-U-493] sin comandas en curso, la lista queda vacía y no cambia la original", () => {
    const soloRecibidos = [pedido("r", "RECIBIDO", "12:00")];
    expect(comandasDelMonitor(soloRecibidos)).toEqual([]);
    const copia = [...PEDIDOS];
    comandasDelMonitor(PEDIDOS);
    expect(PEDIDOS).toEqual(copia);
  });
});

describe("resumenMonitor", () => {
  it("[TC-U-494] cuenta en preparación, listos y en espera (recibidos)", () => {
    expect(resumenMonitor(PEDIDOS)).toEqual({
      enPreparacion: 2,
      listos: 2,
      enEspera: 1,
    });
    expect(resumenMonitor([])).toEqual({
      enPreparacion: 0,
      listos: 0,
      enEspera: 0,
    });
  });
});

describe("densidadMonitor", () => {
  it.each([
    [0, "grande"],
    [4, "grande"],
    [5, "media"],
    [9, "media"],
    [10, "compacta"],
    [50, "compacta"],
  ])("[TC-U-495] %i comandas → %s", (cantidad, esperada) => {
    expect(densidadMonitor(cantidad)).toBe(esperada);
  });

  it("[TC-U-496] cuantas más comandas, más angostas las tarjetas", () => {
    expect(ANCHO_MINIMO_TARJETA.grande).toBeGreaterThan(
      ANCHO_MINIMO_TARJETA.media,
    );
    expect(ANCHO_MINIMO_TARJETA.media).toBeGreaterThan(
      ANCHO_MINIMO_TARJETA.compacta,
    );
  });
});

describe("textos del resumen", () => {
  it("[TC-U-497] en preparación con y sin límite, y las comandas que no entran", () => {
    expect(textoEnPreparacion(2, 5)).toBe("2 de 5");
    expect(textoEnPreparacion(3, null)).toBe("3");
    expect(textoOcultas(1)).toBe("+1 pedido más");
    expect(textoOcultas(4)).toBe("+4 pedidos más");
  });
});
