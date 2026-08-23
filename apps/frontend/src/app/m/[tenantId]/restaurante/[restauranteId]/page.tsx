import { notFound } from 'next/navigation';
import MenuPublico from '@/components/MenuPublico';
import type { MenuPublicoResponse } from '@/types/menu';

interface PageProps {
  params: Promise<{
    tenantId: string;
    restauranteId: string;
  }>;
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  try {
    const response = await fetch(
      `${apiUrl}/menu/tenant/${tenantId}/restaurante/${restauranteId}`,
      { cache: 'no-store' },
    );

    if (!response.ok) {
      notFound();
    }

    const data: MenuPublicoResponse = await response.json();

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