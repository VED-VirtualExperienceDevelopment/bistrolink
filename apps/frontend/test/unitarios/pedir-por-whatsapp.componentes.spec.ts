/**
 * @jest-environment jsdom
 */
// HU-010 (BL-613): «¿Preferís pedir por WhatsApp?» en el menú para retirar y
// el número del bot en Configuración. Componentes reales con React Testing
// Library; la API, socket.io y next/navigation se reemplazan por dobles.
import { createElement, type ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PedirPorWhatsapp } from "@/components/retiro/PedirPorWhatsapp";
import SeccionRetiro from "@/components/admin/configuracion/SeccionRetiro";
import MenuDigital from "@/components/MenuDigital";
import { formularioDesde } from "@/components/admin/configuracion/configuracion.utils";

jest.mock("@/lib/api-client", () => ({
  apiFetch: jest.fn(() => new Promise(() => {})),
  ApiError: class ApiError extends Error {},
}));
jest.mock("socket.io-client", () => ({
  io: () => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    connected: false,
  }),
}));
// Lo que el menú carga aparte (carrito, pago): fuera de este test.
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => () => null,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom no trae matchMedia (el menú lo usa para saber si la pantalla es ancha).
beforeAll(() => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }),
  });
});

const NUMERO = "59899123456";
const ABIERTO = {
  habilitado: true,
  abierto: true,
  horaDesde: null,
  horaHasta: null,
};

describe("PedirPorWhatsapp (BL-613)", () => {
  it("[TC-U-698] abre el chat del bot en otra pestaña, con un nombre que avisa que se abre WhatsApp", () => {
    render(createElement(PedirPorWhatsapp, { numero: NUMERO }));

    const enlace = screen.getByRole("link", {
      name: "¿Preferís pedir por WhatsApp? (se abre WhatsApp)",
    });
    expect(enlace.getAttribute("href")).toBe(
      "https://wa.me/59899123456?text=Hola",
    );
    expect(enlace.getAttribute("target")).toBe("_blank");
    expect(enlace.getAttribute("rel")).toBe("noopener noreferrer");
    // El glifo oficial, decorativo: el nombre del enlace lo da el texto.
    const icono = enlace.querySelector("img");
    expect(icono?.getAttribute("src")).toBe("/marcas/whatsapp/glifo-verde.svg");
    expect(icono?.getAttribute("alt")).toBe("");
  });
});

describe("MenuDigital: enlace a WhatsApp según el menú (BL-613)", () => {
  type Props = ComponentProps<typeof MenuDigital>;
  const base: Omit<Props, "origen"> = {
    restaurante: {
      nombre: "Restaurante Testing A",
      direccion: "Av. Italia 1234",
    },
    categorias: [],
  };

  it("[TC-U-699] en el menú para retirar abierto aparece; cerrado, en la mesa o sin número, no", () => {
    const publico: Props["origen"] = {
      tipo: "publico",
      tenantId: "11111111-1111-1111-1111-111111111111",
      restauranteId: "22222222-2222-2222-2222-222222222222",
    };
    const { rerender } = render(
      createElement(MenuDigital, {
        ...base,
        origen: publico,
        retiro: ABIERTO,
        whatsapp: NUMERO,
      }),
    );
    const portada = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(within(portada).getByTestId("pedir-por-whatsapp")).toBeTruthy();

    rerender(
      createElement(MenuDigital, {
        ...base,
        origen: publico,
        retiro: { ...ABIERTO, abierto: false },
        whatsapp: NUMERO,
      }),
    );
    expect(screen.queryByTestId("pedir-por-whatsapp")).toBeNull();

    rerender(
      createElement(MenuDigital, {
        ...base,
        origen: publico,
        retiro: ABIERTO,
        whatsapp: null,
      }),
    );
    expect(screen.queryByTestId("pedir-por-whatsapp")).toBeNull();

    rerender(
      createElement(MenuDigital, {
        ...base,
        origen: { tipo: "mesa", qrToken: "qr", sesionMesa: "sesion" },
        numeroMesa: 3,
        whatsapp: NUMERO,
      }),
    );
    expect(screen.queryByTestId("pedir-por-whatsapp")).toBeNull();
  });
});

describe("SeccionRetiro: número del bot (BL-613)", () => {
  const guardada = {
    razonSocial: "Uno SRL",
    rut: "219999990016",
    efectivoHabilitado: true,
    mercadoPagoHabilitado: true,
    plexoHabilitado: false,
    handyHabilitado: false,
    propinasSugeridas: [],
    cfeProveedor: "SURTEC" as const,
    mediosPagoDisponibles: ["EFECTIVO", "MERCADOPAGO"] as never[],
    proveedoresCfeDisponibles: ["SURTEC" as const],
    retiroHabilitado: true,
    retiroHoraDesde: null,
    retiroHoraHasta: null,
    whatsappPedidos: "+59899123456",
  };
  const seccion = (props: Partial<ComponentProps<typeof SeccionRetiro>>) =>
    createElement(SeccionRetiro, {
      formulario: formularioDesde(guardada as never),
      error: null,
      onCambiar: jest.fn(),
      ...props,
    });

  it("[TC-U-700] muestra el número, si el bot está conectado y el error; al escribir avisa el cambio", () => {
    const onCambiar = jest.fn();
    const { rerender } = render(seccion({ onCambiar, botConectado: true }));

    const campo = screen.getByLabelText("WhatsApp del bot (opcional)");
    expect((campo as HTMLInputElement).value).toBe("+59899123456");
    expect(screen.getByText(/está conectado para este local/)).toBeTruthy();
    fireEvent.change(campo, { target: { value: "098 765 432" } });
    expect(onCambiar).toHaveBeenCalledWith("whatsappPedidos", "098 765 432");

    rerender(seccion({ errorWhatsapp: "Escribí un celular uruguayo." }));
    expect(screen.getByText(/todavía no está conectado/)).toBeTruthy();
    expect(screen.getByText("Escribí un celular uruguayo.")).toBeTruthy();
    expect(campo.getAttribute("aria-invalid")).toBe("true");
    expect(campo.getAttribute("aria-describedby")).toContain(
      "retiro-whatsapp-error",
    );
  });

  it("[TC-U-700] sin el campo en el backend, o con el retiro apagado, no se muestra", () => {
    const { rerender } = render(
      seccion({
        formulario: {
          ...formularioDesde(guardada as never),
          whatsappPedidos: null,
        },
      }),
    );
    expect(screen.queryByLabelText("WhatsApp del bot (opcional)")).toBeNull();

    rerender(
      seccion({
        formulario: {
          ...formularioDesde(guardada as never),
          retiroHabilitado: false,
        },
      }),
    );
    expect(screen.queryByLabelText("WhatsApp del bot (opcional)")).toBeNull();
  });
});
