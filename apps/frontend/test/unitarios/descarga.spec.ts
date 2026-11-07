import { bytesDesdeBase64, descargarArchivo } from "@/lib/descarga";
import { rutaPdfComprobante as rutaPdfComensal } from "@/components/pago/pago.utils";
import { rutaPdfComprobante as rutaPdfAdmin } from "@/components/admin/comprobantes/comprobantes.utils";

// HU-009 (BL-454): descarga del PDF del comprobante (viene en base64).

describe("descarga (HU-009, BL-454)", () => {
  it("decodifica el base64 a bytes", () => {
    const pdf = Buffer.from("%PDF-1.4 ñ");
    expect(
      Buffer.from(bytesDesdeBase64(pdf.toString("base64"))).equals(pdf),
    ).toBe(true);
  });

  it("descarga el archivo con su nombre y tipo, y libera la URL", () => {
    jest.useFakeTimers();
    const enlace = {
      href: "",
      download: "",
      click: jest.fn(),
      remove: jest.fn(),
    };
    const appendChild = jest.fn();
    (globalThis as { document?: unknown }).document = {
      createElement: jest.fn(() => enlace),
      body: { appendChild },
    };
    const createObjectURL = jest.fn((_blob: Blob) => "blob:prueba");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    descargarArchivo({
      nombreArchivo: "e-Ticket-A-0000049.pdf",
      mimeType: "application/pdf",
      contenido: Buffer.from("%PDF-1.4").toString("base64"),
    });

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(8);
    expect(enlace).toMatchObject({
      href: "blob:prueba",
      download: "e-Ticket-A-0000049.pdf",
    });
    expect(appendChild).toHaveBeenCalledWith(enlace);
    expect(enlace.click).toHaveBeenCalled();
    expect(enlace.remove).toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:prueba");

    delete (globalThis as { document?: unknown }).document;
    jest.useRealTimers();
  });

  it("rutas del PDF: la del comensal (con el acceso del pago) y la del admin", () => {
    expect(rutaPdfComensal("p 1")).toBe("/pedidos/p%201/pagos/comprobante/pdf");
    expect(rutaPdfAdmin("c 1")).toBe("/admin/comprobantes/c%201/pdf");
  });
});
