import {
  empiezaHojaNueva,
  HOJA,
  posicionTarjeta,
  TARJETA,
  type TarjetaQr,
} from "./qr-pdf.utils";

// Tamaño del QR dentro de la tarjeta (mm). Con ~6 cm se lee bien con
// cualquier celular desde la distancia de una mesa.
const LADO_QR = 60;

/**
 * HU-034 (BL-204): arma y descarga el PDF con los QR (A4, 4 por hoja).
 *
 * jsPDF y qrcode se cargan recién al hacer clic (import dinámico): son
 * pesados y solo los usa el administrador, así que no entran en el bundle
 * del resto del panel ni del comensal.
 *
 * El PDF se genera completo en el navegador: las URLs (con el token del QR) no salen
 * hacia ningún servicio externo.
 */
export async function descargarPdfQr(
  tarjetas: TarjetaQr[],
  nombreArchivo: string,
): Promise<void> {
  const [{ jsPDF }, QRCode] = await Promise.all([
    import("jspdf"),
    import("qrcode"),
  ]);

  // Corrección de errores "M": tolera algo de suciedad o desgaste del
  // papel sin agrandar demasiado el código. Se generan todos en paralelo
  // antes de armar el PDF (no dependen entre sí).
  const pngs = await Promise.all(
    tarjetas.map((tarjeta) =>
      QRCode.toDataURL(tarjeta.url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 600,
      }),
    ),
  );

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  for (const [indice, tarjeta] of tarjetas.entries()) {
    if (empiezaHojaNueva(indice)) {
      doc.addPage("a4", "portrait");
    }
    const { x, y } = posicionTarjeta(indice);

    const centroX = x + TARJETA.ancho / 2;

    // Borde punteado para recortar.
    doc.setDrawColor(180);
    doc.setLineDashPattern([2, 2], 0);
    doc.rect(x, y, TARJETA.ancho, TARJETA.alto);
    doc.setLineDashPattern([], 0);

    doc.setTextColor(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(tarjeta.titulo, centroX, y + 20, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(tarjeta.subtitulo, centroX, y + 28, {
      align: "center",
      maxWidth: TARJETA.ancho - 10,
    });

    // Corrección de errores "M": tolera algo de suciedad o desgaste del
    // papel sin agrandar demasiado el código.
    const png = await QRCode.toDataURL(tarjeta.url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 600,
    });
    doc.addImage(
      pngs[indice],
      "PNG",
      centroX - LADO_QR / 2,
      y + 36,
      LADO_QR,
      LADO_QR,
    );

    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(tarjeta.pie, centroX, y + 36 + LADO_QR + 10, {
      align: "center",
      maxWidth: TARJETA.ancho - 10,
    });
  }

  if (tarjetas.length === 0) {
    doc.text("No hay mesas", HOJA.ancho / 2, 30, { align: "center" });
  }

  doc.save(nombreArchivo);
}
