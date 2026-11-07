import {
  borrarPedidoEnCurso,
  clavePedidoEnCurso,
  decidirRetoma,
  guardarPedidoEnCurso,
  leerPedidoEnCurso,
  MENSAJE_PEDIDO_CANCELADO,
  MENSAJE_PEDIDO_NO_DISPONIBLE,
  retomaDeError,
  type Almacen,
  type PedidoEnCurso,
} from "@/components/pago/pedido-en-curso.utils";
import { pantallaAlAbrir } from "@/components/pago/pago.utils";
import {
  llamadosDelSnapshot,
  quitarLlamadoDePedido,
  type LlamadoMozo,
} from "@/components/kds/llamado.utils";
import {
  MENSAJE_MESA_CERRADA,
  MENSAJE_SESION_VENCIDA,
} from "@/components/menu-digital.utils";

// BL-448: retomar el pedido en curso al recargar y avisos de efectivo que no
// se pierden en el KDS.

function almacenEnMemoria(): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (c) => datos.get(c) ?? null,
    setItem: (c, v) => void datos.set(c, v),
    removeItem: (c) => void datos.delete(c),
  };
}

const MESA = { tipo: "mesa", qrToken: "qr-mesa-3", sesionMesa: "s1" } as const;
const WEB = { tipo: "publico", tenantId: "t1", restauranteId: "r1" } as const;

const PEDIDO: PedidoEnCurso = {
  pedidoId: "pedido-1",
  firma: '{"items":[["item-1",2,""]],"nota":""}',
  lineas: [
    {
      itemCartaId: "item-1",
      nombre: "Milanesa",
      precio: 590,
      cantidad: 2,
      imagenUrl: null,
    },
  ],
  observacionGeneral: "",
};

describe("pedido en curso (BL-448)", () => {
  describe("clavePedidoEnCurso", () => {
    it("una por mesa (QR) y una por local para retirar", () => {
      expect(clavePedidoEnCurso(MESA)).toBe(
        "bistrolink:pedido-en-curso:mesa:qr-mesa-3",
      );
      expect(clavePedidoEnCurso(WEB)).toBe("bistrolink:pedido-en-curso:web:r1");
    });
  });

  describe("guardar, leer y borrar", () => {
    it("lo guardado se lee igual", () => {
      const almacen = almacenEnMemoria();
      guardarPedidoEnCurso(almacen, "c", PEDIDO);

      expect(leerPedidoEnCurso(almacen, "c")).toEqual({
        ...PEDIDO,
        tokenAcceso: undefined,
        aprobado: false,
      });
    });

    it("un pedido para retirar guarda su token de acceso; aprobado se conserva", () => {
      const almacen = almacenEnMemoria();
      guardarPedidoEnCurso(almacen, "c", {
        ...PEDIDO,
        tokenAcceso: "tok-retiro",
        aprobado: true,
      });

      expect(leerPedidoEnCurso(almacen, "c")).toMatchObject({
        tokenAcceso: "tok-retiro",
        aprobado: true,
      });
    });

    it("[S] no guarda nada fuera de la lista: ni el JWT ni datos de tarjeta", () => {
      const almacen = almacenEnMemoria();
      guardarPedidoEnCurso(almacen, "c", {
        ...PEDIDO,
        accessToken: "eyJ.jwt.del.comensal",
        datosPasarela: { token: "tok-tarjeta" },
      } as PedidoEnCurso);

      const crudo = almacen.datos.get("c") ?? "";
      expect(crudo).not.toContain("eyJ");
      expect(crudo).not.toContain("tok-tarjeta");
      expect(Object.keys(JSON.parse(crudo)).sort()).toEqual(
        ["firma", "lineas", "observacionGeneral", "pedidoId", "v"].sort(),
      );
    });

    it("datos rotos o de otra versión: null y se borran", () => {
      const almacen = almacenEnMemoria();
      almacen.setItem("rota", "{no es json");
      almacen.setItem("vieja", JSON.stringify({ ...PEDIDO, v: 0 }));
      almacen.setItem(
        "sin-lineas",
        JSON.stringify({ ...PEDIDO, v: 1, lineas: [{ nombre: 1 }] }),
      );

      expect(leerPedidoEnCurso(almacen, "rota")).toBeNull();
      expect(leerPedidoEnCurso(almacen, "vieja")).toBeNull();
      expect(leerPedidoEnCurso(almacen, "sin-lineas")).toBeNull();
      expect(almacen.datos.has("vieja")).toBe(false);
      expect(almacen.datos.has("sin-lineas")).toBe(false);
    });

    it("sin almacenamiento o si el navegador lo bloquea, no lanza", () => {
      const bloqueado: Almacen = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      };

      expect(leerPedidoEnCurso(null, "c")).toBeNull();
      expect(leerPedidoEnCurso(bloqueado, "c")).toBeNull();
      expect(() => guardarPedidoEnCurso(bloqueado, "c", PEDIDO)).not.toThrow();
      expect(() => borrarPedidoEnCurso(bloqueado, "c")).not.toThrow();
    });

    it("borrar deja la clave vacía", () => {
      const almacen = almacenEnMemoria();
      guardarPedidoEnCurso(almacen, "c", PEDIDO);
      borrarPedidoEnCurso(almacen, "c");

      expect(leerPedidoEnCurso(almacen, "c")).toBeNull();
    });
  });

  describe("decidirRetoma (según GET /pedidos/:id/pagos)", () => {
    it("PENDIENTE_PAGO: vuelve a la pantalla de pago del mismo pedido", () => {
      expect(
        decidirRetoma({ estadoPedido: "PENDIENTE_PAGO", pago: null }),
      ).toEqual({ accion: "pago" });
    });

    it.each(["RECIBIDO", "EN_PREPARACION", "LISTO_PARA_ENTREGAR", "ENTREGADO"])(
      "%s (ya pagado): muestra la confirmación",
      (estadoPedido) => {
        expect(decidirRetoma({ estadoPedido, pago: null })).toEqual({
          accion: "aprobado",
        });
      },
    );

    it("PENDIENTE_PAGO con un pago aprobado: muestra la confirmación", () => {
      expect(
        decidirRetoma({
          estadoPedido: "PENDIENTE_PAGO",
          pago: {
            id: "p",
            estado: "APROBADO",
            medioPago: "EFECTIVO",
            monto: "1180.00",
          },
        }),
      ).toEqual({ accion: "aprobado" });
    });

    it("CANCELADO: se descarta con aviso", () => {
      expect(decidirRetoma({ estadoPedido: "CANCELADO", pago: null })).toEqual({
        accion: "descartar",
        aviso: MENSAJE_PEDIDO_CANCELADO,
      });
    });
  });

  describe("retomaDeError", () => {
    it("410 de la mesa: se descarta con el mensaje de la mesa", () => {
      expect(retomaDeError(410, "MESA_CERRADA")).toEqual({
        accion: "descartar",
        aviso: MENSAJE_MESA_CERRADA,
      });
      expect(retomaDeError(410, "SESION_VENCIDA")).toEqual({
        accion: "descartar",
        aviso: MENSAJE_SESION_VENCIDA,
      });
    });

    it.each([400, 403, 404])(
      "%i: el pedido ya no está disponible",
      (status) => {
        expect(retomaDeError(status)).toEqual({
          accion: "descartar",
          aviso: MENSAJE_PEDIDO_NO_DISPONIBLE,
        });
      },
    );

    it.each([0, 500, 503])(
      "%i (sin red o servidor caído): se conserva para la próxima",
      (status) => {
        expect(retomaDeError(status)).toEqual({ accion: "conservar" });
      },
    );
  });

  describe("pantallaAlAbrir («Pagar»)", () => {
    const efectivo = {
      disponible: true,
      solicitadoEn: "2026-10-31T23:00:00Z",
      pagaCon: null,
    };

    it("mesa que ya avisó al mozo: «Esperando al mozo»", () => {
      expect(
        pantallaAlAbrir(
          { estadoPedido: "PENDIENTE_PAGO", pago: null, efectivo },
          true,
        ),
      ).toBe("efectivo");
    });

    it("pago con tarjeta PENDIENTE: verificando, sin ofrecer pagar de nuevo", () => {
      const pago = {
        id: "p",
        estado: "PENDIENTE" as const,
        medioPago: "MERCADOPAGO",
        monto: "590.00",
      };
      expect(
        pantallaAlAbrir(
          { estadoPedido: "PENDIENTE_PAGO", pago, efectivo },
          true,
        ),
      ).toBe("verificando");
      expect(
        pantallaAlAbrir({ estadoPedido: "PENDIENTE_PAGO", pago }, false),
      ).toBe("verificando");
    });

    it("sin nada en curso, o un pedido para retirar con datos de efectivo: formulario", () => {
      expect(
        pantallaAlAbrir({ estadoPedido: "PENDIENTE_PAGO", pago: null }, true),
      ).toBe("formulario");
      expect(
        pantallaAlAbrir(
          { estadoPedido: "PENDIENTE_PAGO", pago: null, efectivo },
          false,
        ),
      ).toBe("formulario");
    });
  });
});

describe("alertas y avisos de efectivo en el KDS (BL-441, BL-448)", () => {
  const atencion: LlamadoMozo = { mesaId: "m1", mesaNumero: 1, ts: 1 };
  const efectivoViejo: LlamadoMozo = {
    mesaId: "m2",
    mesaNumero: 2,
    ts: 2,
    motivo: "PAGO_EFECTIVO",
    pedidoId: "pedido-cobrado",
    total: "300.00",
  };
  const efectivo3: LlamadoMozo = {
    mesaId: "m3",
    mesaNumero: 3,
    ts: 3,
    motivo: "PAGO_EFECTIVO",
    pedidoId: "pedido-3",
    total: "250.00",
    pagaCon: "1000.00",
  };

  it("el snapshot trae todas las alertas pendientes: de atención y de efectivo", () => {
    expect(llamadosDelSnapshot([atencion, efectivo3])).toEqual([
      atencion,
      efectivo3,
    ]);
  });

  it("un snapshot vacío deja la pantalla sin alertas (se atendieron sin conexión)", () => {
    expect(llamadosDelSnapshot([])).toEqual([]);
  });

  it("si el snapshot trae dos alertas de la misma mesa, queda la última", () => {
    const efectivo1 = { ...efectivo3, mesaId: "m1", mesaNumero: 1 };
    expect(llamadosDelSnapshot([atencion, efectivo1])).toEqual([efectivo1]);
  });

  it("al cobrarse el pedido se saca su aviso, y solo ese", () => {
    expect(
      quitarLlamadoDePedido(
        [atencion, efectivoViejo, efectivo3],
        "pedido-cobrado",
      ),
    ).toEqual([atencion, efectivo3]);
  });
});
