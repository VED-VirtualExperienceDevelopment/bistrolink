import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MenuPublico from '@/components/MenuPublico';
import AvisoMesaQr from '@/components/AvisoMesaQr';
import {
  esEstablecimientoSuspendido,
  MENSAJE_RESTAURANTE_NO_DISPONIBLE,
} from '@/components/menu-digital.utils';
import type { MenuPublicoResponse } from '@/types/menu';

interface PageProps {
  readonly params: Promise<{
    readonly tenantId: string;
    readonly restauranteId: string;
  }>;
}

/** BL-413: el establecimiento está suspendido (403 con su código). */
const NO_DISPONIBLE = 'no-disponible' as const;

/**
 * BL-224: `cache` hace que generateMetadata y la página compartan una sola
 * llamada a la API por request (con `no-store`, fetch no la deduplica solo).
 *
 * BL-196: distingue "no existe" de "falló":
 * - 404 → el restaurante no existe (o es de otro tenant, por RLS).
 * - 400 → algún ID no es un UUID válido (ParseUUIDPipe): para el comensal
 *   es lo mismo que un link inexistente.
 *   En ambos casos devuelve null y la página responde con notFound().
 * - Cualquier otro error (500, API caída, error de red) se lanza, para que
 *   se loguee y se muestre la página de error en vez de un 404 engañoso.
 *   Mismo criterio que getMenu() de HU-001 en m/[tenantId]/[mesaId]/page.tsx.
 * - BL-413: 403 con el código ESTABLECIMIENTO_SUSPENDIDO → NO_DISPONIBLE.
 */
const obtenerMenuPublico = cache(
  async (
    tenantId: string,
    restauranteId: string,
  ): Promise<MenuPublicoResponse | typeof NO_DISPONIBLE | null> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const response = await fetch(
      `${apiUrl}/menu/tenant/${tenantId}/restaurante/${restauranteId}`,
      { cache: 'no-store' },
    );
    if (response.status === 404 || response.status === 400) {
      return null;
    }
    if (
      response.status === 403 &&
      esEstablecimientoSuspendido(
        response.status,
        await response.json().catch(() => null),
      )
    ) {
      return NO_DISPONIBLE;
    }
    if (!response.ok) {
      throw new Error(`Error al cargar el menú público: ${response.status}`);
    }
    return response.json();
  },
);

// BL-224: la pestaña muestra el nombre del restaurante
// («Restaurante Testing A · BistroLink»); si no se puede cargar, «Menú».
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tenantId, restauranteId } = await params;
  try {
    const data = await obtenerMenuPublico(tenantId, restauranteId);
    if (!data || data === NO_DISPONIBLE) return { title: 'Menú' };
    return { title: data.restaurante.nombre };
  } catch {
    return { title: 'Menú' };
  }
}

/**
 * HU-002: Página pública del menú vía enlace web directo.
 * URL: /m/{tenantId}/restaurante/{restauranteId}
 *
 * Nota: en Next.js 15 `params` es una Promesa, por eso se usa `await params`
 * (mismo patrón que la página de HU-001 en m/[tenantId]/[mesaId]/page.tsx).
 *
 * BL-196: notFound() queda FUERA del try/catch. notFound() funciona lanzando
 * una excepción interna de Next (NEXT_HTTP_ERROR_FALLBACK;404); si la atrapa
 * el catch, cada 404 legítimo se loguea como error. El try/catch envuelve
 * solo la llamada a la API: ahí sí se loguea y se relanza el error real.
 */
export default async function MenuPublicoPage({ params }: PageProps) {
  const { tenantId, restauranteId } = await params;

  let data: MenuPublicoResponse | typeof NO_DISPONIBLE | null;
  try {
    data = await obtenerMenuPublico(tenantId, restauranteId);
  } catch (error) {
    console.error('Error en MenuPublicoPage:', error);
    throw error;
  }

  if (!data) {
    notFound();
  }

  if (data === NO_DISPONIBLE) {
    return (
      <AvisoMesaQr
        icono="🕒"
        titulo={MENSAJE_RESTAURANTE_NO_DISPONIBLE}
        detalle="Probá de nuevo más tarde."
      />
    );
  }

  return (
    <MenuPublico
      restaurante={data.restaurante}
      categorias={data.categorias}
      tenantId={tenantId}
      restauranteId={restauranteId}
    />
  );
}
