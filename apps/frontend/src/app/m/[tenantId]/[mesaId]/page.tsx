import type { Metadata } from 'next';
import AvisoMesaQr from '@/components/AvisoMesaQr';

export const metadata: Metadata = { title: 'Menú' };

/**
 * HU-034 (BL-204): enlace viejo de mesa (/m/<tenantId>/<mesaId>).
 *
 * El menú de mesa ahora se abre solo desde el QR (/q/<token>): con los ids
 * en la URL, cualquiera podía armar el enlace de otra mesa y pedir a su
 * nombre. Esta ruta queda para que un QR impreso antes del cambio muestre
 * un aviso claro en vez de un 404. No llama a la API.
 *
 * El link web del local (/m/<tenantId>/restaurante/<restauranteId>, HU-002)
 * es otra ruta y no cambia.
 */
export default function EnlaceViejoMesaPage() {
  return (
    <AvisoMesaQr
      icono="🔗"
      titulo="Este enlace ya no se usa."
      detalle="Escaneá el código QR de tu mesa para ver el menú y hacer tu pedido."
    />
  );
}
