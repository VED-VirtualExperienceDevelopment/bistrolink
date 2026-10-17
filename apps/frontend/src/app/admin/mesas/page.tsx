'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { apiFetch } from '@/lib/api-client';
import { QrMesasPanel } from '@/components/admin/mesas/QrMesasPanel';

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
  const { token, hasRole } = useKeycloakAuth();
  // HU-034 (BL-204): se incrementa cada vez que se guarda el mapa, para que
  // el panel de QR vuelva a cargar (las mesas nuevas recién tienen QR al
  // guardarse).
  const [versionMapa, setVersionMapa] = useState(0);

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

  // Sin el tope de ancho (max-w-container) que usan las otras pantallas del
  // admin: el lienzo del mapa toma el ancho de su recuadro, así que en un
  // monitor ancho conviene darle todo el espacio.
  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg-mobile text-primary md:text-headline-lg">
          Mapa de mesas
        </h1>
        {/* El MOZO ve el mapa en solo lectura: no puede arrastrar ni rotar. */}
        <p className="text-body-md text-on-surface-variant">
          {hasRole('ADMIN')
            ? 'Arrastrá, rotá y redimensioná las mesas para que el mapa refleje tu salón.'
            : 'Mirá el estado de las mesas en tiempo real.'}
        </p>
      </div>

      {restauranteId ? (
        <>
          <MapaMesasEditor
            restauranteId={restauranteId}
            onGuardado={() => setVersionMapa((v) => v + 1)}
          />
          {/* HU-034 (BL-204): QR imprimibles. Solo ADMIN (el backend también lo exige). */}
          {hasRole('ADMIN') && (
            <QrMesasPanel key={versionMapa} restauranteId={restauranteId} />
          )}
        </>
      ) : (
        <div className="flex justify-center py-12">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}
