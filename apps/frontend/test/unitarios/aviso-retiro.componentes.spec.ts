/**
 * @jest-environment jsdom
 */
// BL-603: el aviso de «listo» del pedido para retirar, según el canal.
//
// Primeros tests de componentes del frontend (React Testing Library sobre
// jsdom). Solo este archivo usa jsdom (docblock de arriba): el resto de los
// unitarios sigue en «node», como dice jest.config.js. Se renderiza el
// componente real; lo de afuera (socket.io, API, notificaciones del
// navegador) se reemplaza por dobles.
import { act, createElement, type ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AvisoRetiro } from "@/components/retiro/AvisoRetiro";
import { SeguimientoPedido } from "@/components/SeguimientoPedido";
import { PagoAprobado } from "@/components/pago/PagoAprobado";
import { apiFetch } from "@/lib/api-client";
import {
  TEXTO_AVISO_ACTIVADO,
  TEXTO_AYUDA_AVISO,
} from "@/components/retiro/retiro.utils";

// Socket de mentira: guarda los handlers para poder emitir eventos.
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler[]>();
const socketFalso = {
  connected: true,
  on: jest.fn((evento: string, fn: Handler) => {
    handlers.set(evento, [...(handlers.get(evento) ?? []), fn]);
  }),
  off: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
};
const emitir = (evento: string, payload: unknown) =>
  handlers.get(evento)?.forEach((fn) => fn(payload));

jest.mock("socket.io-client", () => ({ io: () => socketFalso }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
// next/dynamic carga el seguimiento en el navegador (ssr: false); en el test
// alcanza con el componente directo.
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () =>
    function SeguimientoDirecto(
      props: ComponentProps<typeof SeguimientoPedido>,
    ) {
      const { SeguimientoPedido: Real } = jest.requireActual<
        typeof import("@/components/SeguimientoPedido")
      >("@/components/SeguimientoPedido");
      return createElement(Real, props);
    },
}));

/** Notification del navegador, con el permiso que diga el test. */
function instalarNotificaciones(permiso: NotificationPermission) {
  const creadas: { titulo: string; cuerpo?: string }[] = [];
  class NotificacionFalsa {
    static permission: NotificationPermission = permiso;
    static requestPermission = jest.fn(async () => {
      NotificacionFalsa.permission = "granted";
      return "granted" as NotificationPermission;
    });
    onclick: (() => void) | null = null;
    constructor(titulo: string, opciones?: NotificationOptions) {
      creadas.push({ titulo, cuerpo: opciones?.body });
    }
    close() {}
  }
  Object.defineProperty(globalThis, "Notification", {
    value: NotificacionFalsa,
    configurable: true,
    writable: true,
  });
  return { creadas, NotificacionFalsa };
}

beforeEach(() => {
  handlers.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  delete (globalThis as { Notification?: unknown }).Notification;
});

describe("AvisoRetiro (BL-603)", () => {
  it("[TC-U-684] pedido web sin permiso: ofrece el aviso con la aclaración y, al aceptarlo, avisa con una notificación cuando está listo", async () => {
    const { creadas, NotificacionFalsa } = instalarNotificaciones("default");
    // Sin la prop: el comportamiento de siempre (pedido web).
    const { rerender } = render(
      createElement(AvisoRetiro, { listo: false, codigo: "R-007" }),
    );

    const boton = await screen.findByRole("button", {
      name: "Avisarme cuando esté listo",
    });
    expect(boton.getAttribute("aria-describedby")).toBe("ayuda-aviso-retiro");
    expect(screen.getByText(TEXTO_AYUDA_AVISO)).toBeTruthy();
    expect(screen.queryByText(/pestaña abierta/)).toBeNull();

    fireEvent.click(boton);
    await screen.findByText(TEXTO_AVISO_ACTIVADO);
    expect(NotificacionFalsa.requestPermission).toHaveBeenCalledTimes(1);

    rerender(
      createElement(AvisoRetiro, {
        listo: true,
        codigo: "R-007",
        porWhatsapp: false,
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("R-007");
    expect(creadas).toEqual([
      {
        titulo: "Tu pedido está listo",
        cuerpo: "Retiralo en el mostrador con el código R-007.",
      },
    ]);
  });

  it("[TC-U-685] pedido de WhatsApp: no ofrece el aviso del navegador ni manda la notificación, pero muestra el cartel de listo", async () => {
    const { creadas } = instalarNotificaciones("granted");
    const { rerender } = render(
      createElement(AvisoRetiro, {
        listo: false,
        codigo: "R-008",
        porWhatsapp: true,
      }),
    );
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(TEXTO_AVISO_ACTIVADO)).toBeNull();

    rerender(
      createElement(AvisoRetiro, {
        listo: true,
        codigo: "R-008",
        porWhatsapp: true,
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("R-008");
    expect(creadas).toEqual([]);
  });
});

describe("SeguimientoPedido (BL-603)", () => {
  const props = {
    pedidoId: "p-1",
    token: "jwt",
    estadoInicial: "RECIBIDO" as const,
    paraRetirar: true,
    codigoRetiro: "R-009",
  };

  it("[TC-U-686] pasa el canal al aviso: con WhatsApp no hay botón; en la web sí, y la hora de actualización se ve", async () => {
    instalarNotificaciones("default");
    const { rerender } = render(
      createElement(SeguimientoPedido, { ...props, avisoPorWhatsapp: true }),
    );
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();

    // Sin la prop: pedido web, como antes de BL-603.
    rerender(createElement(SeguimientoPedido, props));
    expect(
      await screen.findByRole("button", { name: "Avisarme cuando esté listo" }),
    ).toBeTruthy();

    act(() =>
      emitir("pedido:actualizado", {
        id: "p-1",
        estado: "EN_PREPARACION",
        actualizadoEn: "2026-11-22T22:00:00.000Z",
      }),
    );
    expect(screen.getByText(/^Actualizado /)).toBeTruthy();
    // Las etiquetas de los pasos con el gris que cumple 4,5:1.
    expect(screen.getByText("Entregado").className).toContain("text-[#5a575e]");
  });
});

describe("PagoAprobado (BL-603)", () => {
  const estadoDelPago = (avisoPorWhatsapp: boolean) => ({
    pedidoId: "p-2",
    estadoPedido: "RECIBIDO",
    codigoRetiro: "R-010",
    avisoPorWhatsapp,
    pago: {
      id: "pago",
      estado: "APROBADO",
      medioPago: "MERCADOPAGO",
      monto: "120.00",
      motivoRechazo: null,
    },
    comprobante: null,
  });

  const pantalla = () =>
    createElement(PagoAprobado, {
      origen: { tipo: "link", linkToken: "x".repeat(60) },
      pedidoId: "p-2",
      accessToken: "jwt",
      lineas: [
        { itemCartaId: "a", nombre: "Helado", cantidad: 1, precio: 120 },
      ],
      total: 120,
      sinBarraDeLaCarta: true,
    } as ComponentProps<typeof PagoAprobado>);

  it("[TC-U-687] pedido del bot: dice que avisa por WhatsApp y no ofrece la notificación del navegador", async () => {
    instalarNotificaciones("default");
    jest.mocked(apiFetch).mockResolvedValue(estadoDelPago(true));
    render(pantalla());

    expect(
      await screen.findByText(
        "Te avisamos por WhatsApp cuando esté listo para retirar.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Avisarme cuando esté listo" }),
    ).toBeNull();
  });

  it("[TC-U-688] pedido web: dice que avisa en esta página y ofrece la notificación", async () => {
    instalarNotificaciones("default");
    jest.mocked(apiFetch).mockResolvedValue(estadoDelPago(false));
    render(pantalla());

    expect(
      await screen.findByText(
        "Te avisamos en esta página cuando esté listo para retirar.",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Avisarme cuando esté listo" }),
      ).toBeTruthy(),
    );
  });
});
