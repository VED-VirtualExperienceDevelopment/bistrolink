import {
  COLUMNAS,
  empiezaHojaNueva,
  HOJA,
  MARGEN_HOJA,
  nombreArchivoPdf,
  PIE_TARJETA_MESA,
  PIE_TARJETA_WEB,
  posicionTarjeta,
  slugArchivo,
  TARJETA,
  TARJETAS_POR_HOJA,
  tarjetasDeQr,
} from "@/components/admin/mesas/qr-pdf.utils";
import type { QrRestaurante } from "@/types/qr-mesa";

// HU-034 (BL-204): PDF imprimible con los QR de las mesas.

const DATOS: QrRestaurante = {
  restaurante: {
    id: "22222222-2222-2222-2222-222222222222",
    nombre: "Restaurante Testing A",
    urlWeb: "https://bistrolink.test/m/t/restaurante/r",
  },
  // Desordenadas a propósito: el PDF sale por número de mesa.
  mesas: [
    { id: "mesa-2", numero: 2, url: "https://bistrolink.test/q/token-2" },
    { id: "mesa-1", numero: 1, url: "https://bistrolink.test/q/token-1" },
    { id: "mesa-10", numero: 10, url: "https://bistrolink.test/q/token-10" },
  ],
};

describe("tarjetasDeQr", () => {
  it("una tarjeta por mesa, ordenadas por número, y el link web al final", () => {
    const tarjetas = tarjetasDeQr(DATOS);

    expect(tarjetas.map((t) => t.titulo)).toEqual([
      "Mesa 1",
      "Mesa 2",
      "Mesa 10",
      "Pedidos para retirar",
    ]);
    expect(tarjetas[0]).toEqual({
      titulo: "Mesa 1",
      subtitulo: "Restaurante Testing A",
      pie: PIE_TARJETA_MESA,
      url: "https://bistrolink.test/q/token-1",
    });
    expect(tarjetas[3]).toEqual({
      titulo: "Pedidos para retirar",
      subtitulo: "Restaurante Testing A",
      pie: PIE_TARJETA_WEB,
      url: DATOS.restaurante.urlWeb,
    });
  });

  it("con una mesa: solo esa tarjeta, sin el link web", () => {
    expect(tarjetasDeQr(DATOS, "mesa-2")).toEqual([
      {
        titulo: "Mesa 2",
        subtitulo: "Restaurante Testing A",
        pie: PIE_TARJETA_MESA,
        url: "https://bistrolink.test/q/token-2",
      },
    ]);
  });

  it("no cambia el orden del array original", () => {
    const antes = DATOS.mesas.map((m) => m.numero);
    tarjetasDeQr(DATOS);
    expect(DATOS.mesas.map((m) => m.numero)).toEqual(antes);
  });

  it("sin mesas: solo el link web", () => {
    expect(tarjetasDeQr({ ...DATOS, mesas: [] }).map((t) => t.titulo)).toEqual([
      "Pedidos para retirar",
    ]);
  });
});

describe("posicionTarjeta / empiezaHojaNueva", () => {
  it("4 tarjetas por hoja, en 2 columnas", () => {
    expect(TARJETAS_POR_HOJA).toBe(4);
    expect(posicionTarjeta(0)).toEqual({
      hoja: 0,
      x: MARGEN_HOJA,
      y: MARGEN_HOJA,
    });
    expect(posicionTarjeta(1)).toEqual({
      hoja: 0,
      x: MARGEN_HOJA + TARJETA.ancho,
      y: MARGEN_HOJA,
    });
    expect(posicionTarjeta(2)).toEqual({
      hoja: 0,
      x: MARGEN_HOJA,
      y: MARGEN_HOJA + TARJETA.alto,
    });
    expect(posicionTarjeta(4)).toEqual({
      hoja: 1,
      x: MARGEN_HOJA,
      y: MARGEN_HOJA,
    });
  });

  it("las tarjetas entran en la hoja A4 con su margen", () => {
    for (let i = 0; i < TARJETAS_POR_HOJA; i++) {
      const { x, y } = posicionTarjeta(i);
      expect(x + TARJETA.ancho).toBeLessThanOrEqual(
        HOJA.ancho - MARGEN_HOJA + 1e-9,
      );
      expect(y + TARJETA.alto).toBeLessThanOrEqual(
        HOJA.alto - MARGEN_HOJA + 1e-9,
      );
    }
    expect(COLUMNAS * TARJETA.ancho).toBeCloseTo(HOJA.ancho - 2 * MARGEN_HOJA);
  });

  it("se agrega hoja nueva en la tarjeta 5, 9, … (índices 4, 8, …)", () => {
    expect([0, 1, 3, 4, 5, 8].map(empiezaHojaNueva)).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
    ]);
  });
});

describe("nombreArchivoPdf", () => {
  it("PDF de todas las mesas", () => {
    expect(nombreArchivoPdf("Restaurante Testing A")).toBe(
      "qr-mesas-restaurante-testing-a.pdf",
    );
  });

  it("PDF de una mesa", () => {
    expect(nombreArchivoPdf("Restaurante Testing A", 4)).toBe(
      "qr-mesa-4-restaurante-testing-a.pdf",
    );
  });

  it("quita tildes, ñ y símbolos del nombre", () => {
    expect(slugArchivo("  Café & Ñandú / Pocitos ")).toBe("cafe-nandu-pocitos");
  });

  it("si el nombre queda vacío, usa 'restaurante'", () => {
    expect(slugArchivo("***")).toBe("restaurante");
  });
});
