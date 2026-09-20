'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { apiFetch } from '@/lib/api-client';

// Konva/react-konva tocan `window`/`document` al importarse — sin ssr:false
// Next intenta renderizar el módulo en el servidor y el build revienta con
// "window is not defined". Mismo motivo por el que no se puede simplemente
// poner 'use client' arriba del componente y listo.
const MapaMesasEditor = dynamic(
  () => import('@/components/admin/mesas/MapaMesasEditor').then((m) => m.MapaMesasEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center py-12">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    ),
  },
);

export default function MesasPage() {
  const { token } = useKeycloakAuth();

  // Mismo gap de integración que usuarios/page.tsx: CreateUsuarioDto y el
  // layout de mesas exigen restauranteId, y no hay todavía un
  // GET /restaurantes documentado. Se resuelve igual acá (toma el primero
  // que devuelva la API) para no bloquear la pantalla — reemplazar por un
  // selector real si en algún momento un tenant maneja más de un
  // restaurante desde este panel.
  const [restauranteId, setRestauranteId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ id: string }[]>('/restaurantes', token)
      .then((rs) => setRestauranteId(rs[0]?.id ?? null))
      .catch(() => setRestauranteId(null));
  }, [token]);

  return (
    <div className="mx-auto max-w-container space-y-6 p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Mapa de mesas</h1>
        <p className="text-body-md text-on-surface-variant">
          Arrastrá, rotá y redimensioná las mesas para que el mapa refleje tu salón.
        </p>
      </div>

      {restauranteId ? (
        <MapaMesasEditor restauranteId={restauranteId} />
      ) : (
        <div className="flex justify-center py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}
