import { cache } from 'react';
import type { Metadata } from 'next';
import AvisoMesaQr from '@/components/AvisoMesaQr';
import MenuMesaCliente from '@/components/MenuMesaCliente';
import type { CategoriaMenu } from '@/components/MenuDigital';
import { esTokenQrConFormatoValido } from '@/components/menu-digital.utils';

interface PageProps {
  readonly params: Promise<{ readonly token: string }>;
}

interface MenuQrResponse {
  restaurante: { nombre: string };
  categorias: CategoriaMenu[];
  mesa: { numero: number };
}

type ResultadoMenuQr =
  | { estado: 'ok'; menu: MenuQrResponse }
  | { estado: 'invalido' }
  | { estado: 'reemplazado' };

/**
 * HU-034 (BL-204): menú de una mesa a partir del token opaco del QR
 * (GET /menu/qr/:token). `cache`: generateMetadata y la página comparten
 * una sola llamada por request (BL-224).
 *
 * - 404 / 400 → QR no válido (o de otra clave, o de una mesa que ya no
 *   existe): el backend no distingue el motivo, acá tampoco.
 * - 410 → el QR se regeneró y este quedó viejo.
 * - Cualquier otro error (500, API caída) se lanza: no es un QR inválido.
 *
 * El token se valida ANTES de armar la URL: Next decodifica el parámetro, y
 * algo como "..%2Fadmin" terminaría pidiendo otra ruta de la API.
 */
const obtenerMenuPorQr = cache(
  async (token: string): Promise<ResultadoMenuQr> => {
    if (!esTokenQrConFormatoValido(token)) {
      return { estado: 'invalido' };
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(
      `${apiUrl}/menu/qr/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );

    if (res.status === 404 || res.status === 400) {
      return { estado: 'invalido' };
    }
    if (res.status === 410) {
      return { estado: 'reemplazado' };
    }
    if (!res.ok) {
      throw new Error(`Error al cargar el menú de la mesa: ${res.status}`);
    }
    return { estado: 'ok', menu: await res.json() };
  },
);

// `referrer: no-referrer`: la URL lleva el token del QR; que no viaje en el
// header Referer a otros sitios (imágenes, fuentes).
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  try {
    const resultado = await obtenerMenuPorQr(token);
    const title =
      resultado.estado === 'ok' ? resultado.menu.restaurante.nombre : 'Menú';
    return { title, referrer: 'no-referrer' };
  } catch {
    return { title: 'Menú', referrer: 'no-referrer' };
  }
}

export default async function MenuQrPage({ params }: PageProps) {
  const { token } = await params;
  const resultado = await obtenerMenuPorQr(token);

  if (resultado.estado === 'reemplazado') {
    return (
      <AvisoMesaQr
        icono="🔄"
        titulo="Este QR fue reemplazado."
        detalle="Pedile al personal el QR actualizado de la mesa."
      />
    );
  }

  if (resultado.estado === 'invalido') {
    return (
      <AvisoMesaQr
        icono="🔍"
        titulo="No encontramos el menú para esta mesa."
        detalle="Probá escaneando el código QR de nuevo."
      />
    );
  }

  const { menu } = resultado;
  return (
    <MenuMesaCliente
      restaurante={menu.restaurante}
      categorias={menu.categorias}
      qrToken={token}
      numeroMesa={menu.mesa.numero}
    />
  );
}
