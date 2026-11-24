import {
  aplicarActualizacion,
  claveMisPedidos,
  conservarSolo,
  estaEnCamino,
  horaCorta,
  leerMisPedidos,
  limpiarSesionesAnteriores,
  MAXIMO_PEDIDOS_RECORDADOS,
  olvidarMisPedidos,
  pedidosEnCamino,
  recordarPedido,
  resumenDeLineas,
  resumenMisPedidos,
  tonoDelEstado,
  totalDelPedido,
  type AlmacenPersistente,
  type PedidoDeLaMesa,
} from "@/components/mis-pedidos/mis-pedidos.utils";
import type { EstadoPedido } from "@/types/pedido";

// BL-502: «Mis pedidos» del comensal en la mesa.

function almacenEnMemoria(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  const almacen: AlmacenPersistente & { datos: Map<string, string> } = {
    datos,
    get length() {
      return datos.size;
    },
    key: (i) => [...datos.keys()][i] ?? null,
    getItem: (c) => datos.get(c) ?? null,
    setItem: (c, v) => void datos.set(c, v),
    removeItem: (c) => void datos.delete(c),
  };
  return almacen;
}

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLAVE = claveMisPedidos("qr-4", "s2");

const pedido = (
  n: number,
  estado: EstadoPedido,
  extra: Partial<PedidoDeLaMesa> = {},
): PedidoDeLaMesa => ({
  id: id(n),
  estado,
  creadoEn: "2026-11-10T23:41:00.000Z",
  actualizadoEn: "2026-11-10T23:41:00.000Z",
  lineas: [],
  consumo: "0.00",
  propina: 0,
  ...extra,
});

describe("lo que recuerda el navegador", () => {
  it("una lista por mesa y sesión de la mesa", () => {
    expect(CLAVE).toBe("bistrolink:mis-pedidos:qr-4:s2");
    expect(claveMisPedidos("qr-4", "s3")).not.toBe(CLAVE);
  });

  it("recordar agrega al principio, sin repetir y con tope", () => {
    const almacen = almacenEnMemoria();
    recordarPedido(almacen, CLAVE, id(1));
    recordarPedido(almacen, CLAVE, id(2));
    expect(recordarPedido(almacen, CLAVE, id(1))).toEqual([id(1), id(2)]);
    expect(leerMisPedidos(almacen, CLAVE)).toEqual([id(1), id(2)]);

    for (let n = 3; n <= MAXIMO_PEDIDOS_RECORDADOS + 5; n++) {
      recordarPedido(almacen, CLAVE, id(n));
    }
    const ids = leerMisPedidos(almacen, CLAVE);
    expect(ids).toHaveLength(MAXIMO_PEDIDOS_RECORDADOS);
    expect(ids[0]).toBe(id(MAXIMO_PEDIDOS_RECORDADOS + 5));
  });

  it("ignora lo que no es un UUID y lo guardado roto; sin almacenamiento no falla", () => {
    const almacen = almacenEnMemoria({
      [CLAVE]: JSON.stringify([id(1), "x", 3, null]),
    });
    expect(leerMisPedidos(almacen, CLAVE)).toEqual([id(1)]);
    expect(recordarPedido(almacen, CLAVE, "no-es-uuid")).toEqual([id(1)]);

    almacen.setItem(CLAVE, "{roto");
    expect(leerMisPedidos(almacen, CLAVE)).toEqual([]);
    almacen.setItem(CLAVE, '{"a":1}');
    expect(leerMisPedidos(almacen, CLAVE)).toEqual([]);

    expect(leerMisPedidos(null, CLAVE)).toEqual([]);
    expect(recordarPedido(null, CLAVE, id(1))).toEqual([id(1)]);
  });

  it("conservar solo los que reconoce el backend; olvidar borra la clave", () => {
    const almacen = almacenEnMemoria();
    recordarPedido(almacen, CLAVE, id(1));
    recordarPedido(almacen, CLAVE, id(2));
    conservarSolo(almacen, CLAVE, [id(1)]);
    expect(leerMisPedidos(almacen, CLAVE)).toEqual([id(1)]);

    olvidarMisPedidos(almacen, CLAVE);
    expect(almacen.datos.has(CLAVE)).toBe(false);
  });

  it("borra lo de sesiones anteriores de la misma mesa (lista y pago en curso), no lo de otras mesas", () => {
    const almacen = almacenEnMemoria({
      "bistrolink:mis-pedidos:qr-4:s1": "[]",
      "bistrolink:mis-pedidos:qr-4:s2": "[]",
      "bistrolink:mis-pedidos:qr-7:s9": "[]",
      "bistrolink:pedido-en-curso:mesa:qr-4:s1": "{}",
      "bistrolink:pedido-en-curso:mesa:qr-4:s2": "{}",
      "bistrolink:pedido-en-curso:web:r1": "{}",
      otra: "x",
    });
    limpiarSesionesAnteriores(almacen, "qr-4", "s2");
    expect([...almacen.datos.keys()].sort()).toEqual([
      "bistrolink:mis-pedidos:qr-4:s2",
      "bistrolink:mis-pedidos:qr-7:s9",
      "bistrolink:pedido-en-curso:mesa:qr-4:s2",
      "bistrolink:pedido-en-curso:web:r1",
      "otra",
    ]);
    expect(() => limpiarSesionesAnteriores(null, "qr-4", "s2")).not.toThrow();
  });
});

describe("textos y estados", () => {
  it("el resumen del botón dice el estado más importante", () => {
    expect(
      resumenMisPedidos([
        pedido(1, "ENTREGADO"),
        pedido(2, "EN_PREPARACION"),
        pedido(3, "LISTO_PARA_ENTREGAR"),
      ]),
    ).toBe("1 listo");
    expect(
      resumenMisPedidos([
        pedido(1, "EN_PREPARACION"),
        pedido(2, "EN_PREPARACION"),
        pedido(3, "RECIBIDO"),
      ]),
    ).toBe("2 en preparación");
    expect(resumenMisPedidos([pedido(1, "RECIBIDO")])).toBe("1 en cocina");
    expect(
      resumenMisPedidos([
        pedido(1, "LISTO_PARA_ENTREGAR"),
        pedido(2, "LISTO_PARA_ENTREGAR"),
      ]),
    ).toBe("2 listos");
    expect(resumenMisPedidos([pedido(1, "PENDIENTE_PAGO")])).toBe(
      "1 esperando el pago",
    );
    expect(resumenMisPedidos([pedido(1, "ENTREGADO")])).toBe("Todo entregado");
    expect(resumenMisPedidos([pedido(1, "CANCELADO")])).toBe(
      "Sin pedidos en curso",
    );
  });

  it("en camino: los que todavía no llegaron a la mesa", () => {
    expect(estaEnCamino("EN_PREPARACION")).toBe(true);
    expect(estaEnCamino("ENTREGADO")).toBe(false);
    expect(estaEnCamino("CANCELADO")).toBe(false);
    expect(
      pedidosEnCamino([
        pedido(1, "ENTREGADO"),
        pedido(2, "RECIBIDO"),
        pedido(3, "LISTO_PARA_ENTREGAR"),
      ]),
    ).toBe(2);
  });

  it("total con propina, líneas, tono y hora", () => {
    const p = pedido(1, "EN_PREPARACION", {
      consumo: "710.50",
      propina: 71,
      lineas: [
        { nombre: "Milanesa", cantidad: 1 },
        { nombre: "Agua", cantidad: 2 },
      ],
    });
    expect(totalDelPedido(p)).toBe(781.5);
    expect(resumenDeLineas(p)).toBe("1 Milanesa · 2 Agua");
    expect(tonoDelEstado("RECIBIDO")).toBe("espera");
    expect(tonoDelEstado("LISTO_PARA_ENTREGAR")).toBe("listo");
    expect(tonoDelEstado("ENTREGADO")).toBe("entregado");
    expect(tonoDelEstado("CANCELADO")).toBe("cancelado");
    expect(horaCorta("2026-11-10T23:41:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(horaCorta("no es fecha")).toBe("");
  });

  it("aplica el cambio de estado del WebSocket solo al pedido que corresponde", () => {
    const antes = [pedido(1, "RECIBIDO"), pedido(2, "EN_PREPARACION")];
    const despues = aplicarActualizacion(antes, {
      id: id(2),
      estado: "LISTO_PARA_ENTREGAR",
      actualizadoEn: "2026-11-10T23:50:00.000Z",
    });
    expect(despues[0]).toBe(antes[0]);
    expect(despues[1]).toMatchObject({
      estado: "LISTO_PARA_ENTREGAR",
      actualizadoEn: "2026-11-10T23:50:00.000Z",
    });
    expect(
      aplicarActualizacion(antes, { id: id(1), estado: "EN_PREPARACION" })[0]
        .actualizadoEn,
    ).toBe(antes[0].actualizadoEn);
  });
});
