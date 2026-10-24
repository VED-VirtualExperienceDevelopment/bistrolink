/**
 * HU-034 (BL-204): MenuQrPage (/q/[token]) y el aviso de la ruta vieja
 * /m/[tenantId]/[mesaId].
 *
 * Las páginas son Server Components: se las llama como función y se
 * inspecciona el elemento que devuelven, sin renderizar DOM (el config de
 * Jest usa testEnvironment 'node'). Mismo enfoque que menu-publico.page.spec.
 */

jest.mock("@/components/MenuMesaCliente", () => ({
  __esModule: true,
  default: function MenuMesaClienteMock() {
    return null;
  },
}));

// `cache` de React memoiza por request en RSC; en los tests cada caso tiene
// que hacer su propia llamada a fetch.
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  cache: <T>(fn: T) => fn,
}));

import AvisoMesaQr from "@/components/AvisoMesaQr";
import MenuMesaCliente from "@/components/MenuMesaCliente";
import MenuQrPage, { generateMetadata } from "@/app/q/[token]/page";
import EnlaceViejoMesaPage from "@/app/m/[tenantId]/[mesaId]/page";

const TOKEN = "TokenDelQr_123-abc";

const MENU = {
  restaurante: { nombre: "Restaurante Testing A" },
  categorias: [],
  mesa: { numero: 4 },
};

function params(token = TOKEN) {
  return Promise.resolve({ token });
}

function respuesta(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});

describe("MenuQrPage", () => {
  it("con un QR vigente: MenuMesaCliente con el token y el número de mesa, sin ids", async () => {
    fetchMock.mockResolvedValue(respuesta(200, MENU));

    const elemento = await MenuQrPage({ params: params() });

    expect(elemento.type).toBe(MenuMesaCliente);
    expect(elemento.props).toEqual({
      restaurante: MENU.restaurante,
      categorias: MENU.categorias,
      qrToken: TOKEN,
      numeroMesa: 4,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/menu/qr/${TOKEN}$`)),
      { cache: "no-store" },
    );
  });

  it("[TC-U-143] BL-413: 403 de un establecimiento suspendido: aviso «no disponible», sin el menú", async () => {
    fetchMock.mockResolvedValue(
      respuesta(403, {
        statusCode: 403,
        message: "Este restaurante no está disponible por el momento.",
        codigo: "ESTABLECIMIENTO_SUSPENDIDO",
      }),
    );

    const elemento = await MenuQrPage({ params: params() });

    expect(elemento.type).toBe(AvisoMesaQr);
    expect(elemento.props.titulo).toBe(
      "Este restaurante no está disponible por el momento.",
    );
  });

  it("BL-413: un 403 sin el código de suspensión es un error, no «no disponible»", async () => {
    fetchMock.mockResolvedValue(respuesta(403, { message: "Forbidden" }));

    await expect(MenuQrPage({ params: params() })).rejects.toThrow("403");
  });

  it("410 (QR regenerado): aviso de QR reemplazado", async () => {
    fetchMock.mockResolvedValue(respuesta(410));

    const elemento = await MenuQrPage({ params: params() });

    expect(elemento.type).toBe(AvisoMesaQr);
    expect(elemento.props.titulo).toBe("Este QR fue reemplazado.");
  });

  it.each([404, 400])("%i: aviso de menú no encontrado", async (status) => {
    fetchMock.mockResolvedValue(respuesta(status));

    const elemento = await MenuQrPage({ params: params() });

    expect(elemento.type).toBe(AvisoMesaQr);
    expect(elemento.props.titulo).toBe(
      "No encontramos el menú para esta mesa.",
    );
  });

  it.each([
    ["con barras (otra ruta de la API)", "../tenant/x/restaurante/y"],
    ["con caracteres fuera de base64url", "abc+def="],
  ])(
    "token %s: aviso de no encontrado, sin llamar a la API",
    async (_caso, token) => {
      const elemento = await MenuQrPage({ params: params(token) });

      expect(elemento.type).toBe(AvisoMesaQr);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("500: lanza el error (no es un QR inválido)", async () => {
    fetchMock.mockResolvedValue(respuesta(500));

    await expect(MenuQrPage({ params: params() })).rejects.toThrow(
      "Error al cargar el menú de la mesa: 500",
    );
  });
});

describe("generateMetadata (/q/[token])", () => {
  it("título con el nombre del restaurante y sin Referer (la URL lleva el token)", async () => {
    fetchMock.mockResolvedValue(respuesta(200, MENU));

    await expect(generateMetadata({ params: params() })).resolves.toEqual({
      title: "Restaurante Testing A",
      referrer: "no-referrer",
    });
  });

  it.each([410, 500])(
    "si la API responde %i, el título es «Menú»",
    async (status) => {
      fetchMock.mockResolvedValue(respuesta(status));

      await expect(generateMetadata({ params: params() })).resolves.toEqual({
        title: "Menú",
        referrer: "no-referrer",
      });
    },
  );
});

describe("EnlaceViejoMesaPage (/m/[tenantId]/[mesaId])", () => {
  it("muestra el aviso de enlace viejo y no llama a la API", () => {
    const elemento = EnlaceViejoMesaPage();

    expect(elemento.type).toBe(AvisoMesaQr);
    expect(elemento.props.titulo).toBe("Este enlace ya no se usa.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
