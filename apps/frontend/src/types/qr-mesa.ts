// HU-034 (BL-204): forma de las respuestas de GET /mesas/qr y
// POST /mesas/:id/qr/regenerar (MesasQrService en el backend). Solo ADMIN.

/** QR de una mesa: la URL es /q/<token>, sin ids internos. */
export interface QrMesa {
  id: string;
  numero: number;
  url: string;
}

export interface QrRestaurante {
  restaurante: {
    id: string;
    nombre: string;
    /** Link web del local (pedidos para retirar, HU-002). */
    urlWeb: string;
  };
  mesas: QrMesa[];
}
