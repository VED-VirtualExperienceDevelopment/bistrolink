import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MenuPublico from '@/components/MenuPublico';
import type { MenuPublicoResponse } from '@/types/menu';

interface PageProps {
  readonly params: Promise<{
    readonly tenantId: string;
    readonly restauranteId: string;
  }>;
}

/**
 * BL-224: `cache` hace que generateMetadata y la página compartan una sola
 * llamada a la API por request (con `no-store`, fetch no la deduplica solo).
 * Devuelve null si la API responde con error (restaurante inexistente, 404).
 */
const obtenerMenuPublico = cache(
  async (
    tenantId: string,
    restauranteId: string,
  ): Promise<MenuPublicoResponse | null> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const response = await fetch(
      `${apiUrl}/menu/tenant/${tenantId}/restaurante/${restauranteId}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      return null;
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
    return { title: data?.restaurante.nombre ?? 'Menú' };
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
 */
export default async function MenuPublicoPage({ params }: PageProps) {
  const { tenantId, restauranteId } = await params;

  try {
    const data = await obtenerMenuPublico(tenantId, restauranteId);

    if (!data) {
      notFound();
    }

    return (
      <MenuPublico
        restaurante={data.restaurante}
        categorias={data.categorias}
        tenantId={tenantId}
        restauranteId={restauranteId}
      />
    );
  } catch (error) {
    console.error('Error en MenuPublicoPage:', error);
    notFound();
  }
}
