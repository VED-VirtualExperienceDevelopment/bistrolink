import {
  mensajeMesaCerrada,
  opcionSesion,
  puedeGestionarSesion,
  rutaAccionSesion,
} from "@/components/admin/mesas/sesion-mesa.utils";
import { ESTADOS_MESA_VALIDOS } from "@/types/mesa";

// HU-017 (BL-60): sesión de la mesa desde el mapa de mesas.

describe("opcionSesion", () => {
  it.each([
    ["LIBRE", "abrir", "Abrir mesa"],
    ["OCUPADA", "cerrar", "Cerrar mesa"],
    ["EN_PROCESO_DE_PAGO", null, "Pago en curso"],
    ["REQUIERE_LIMPIEZA", "limpia", "Marcar como limpia"],
  ] as const)("%s => %s (%s)", (estado, accion, etiqueta) => {
    expect(opcionSesion(estado)).toMatchObject({ accion, etiqueta });
  });

  it("todos los estados de mesa tienen una opción con ayuda", () => {
    for (const estado of ESTADOS_MESA_VALIDOS) {
      expect(opcionSesion(estado).ayuda.length).toBeGreaterThan(0);
    }
  });
});

describe("rutaAccionSesion", () => {
  it("coincide con MesasController", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    expect(rutaAccionSesion(id, "abrir")).toBe(`/mesas/${id}/abrir`);
    expect(rutaAccionSesion(id, "cerrar")).toBe(`/mesas/${id}/cerrar`);
    expect(rutaAccionSesion(id, "limpia")).toBe(`/mesas/${id}/limpia`);
  });

  it("un id raro no puede cambiar la ruta", () => {
    expect(rutaAccionSesion("../usuarios", "abrir")).toBe(
      "/mesas/..%2Fusuarios/abrir",
    );
  });
});

describe("mensajeMesaCerrada", () => {
  it("sin pedidos cancelados, uno o varios", () => {
    expect(mensajeMesaCerrada(4, 0)).toBe("Mesa 4 cerrada.");
    expect(mensajeMesaCerrada(4, 1)).toBe(
      "Mesa 4 cerrada. Se canceló 1 pedido que no se había pagado.",
    );
    expect(mensajeMesaCerrada(4, 3)).toBe(
      "Mesa 4 cerrada. Se cancelaron 3 pedidos que no se habían pagado.",
    );
  });
});

describe("puedeGestionarSesion", () => {
  it.each([
    [["MOZO"], true],
    [["ADMIN"], true],
    [["COCINA"], false],
    [["COMENSAL"], false],
    [[], false],
  ])("roles %j => %s", (roles, esperado) => {
    const hasRole = (rol: string) => (roles as string[]).includes(rol);
    expect(puedeGestionarSesion(hasRole)).toBe(esperado);
  });
});
