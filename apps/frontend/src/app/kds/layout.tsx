'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';

const ROLES_PERMITIDOS = ['ADMIN', 'COCINA', 'MOZO'];

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  const { initializing, authenticated, hasRole, logout } = useKeycloakAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (initializing) return;
    if (!authenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!ROLES_PERMITIDOS.some((rol) => hasRole(rol))) {
      router.replace('/');
    }
  }, [initializing, authenticated, hasRole, router, pathname]);

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authenticated || !ROLES_PERMITIDOS.some((rol) => hasRole(rol))) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-6 shadow-sm">
        <div className="text-headline-sm font-bold text-primary">Bistro Link — KDS</div>
        <div className="flex items-center gap-2">
          {/* COCINA no tiene ninguna pantalla dentro de /admin/* (no es
              "esStaff" en admin/layout.tsx), así que para ese rol este link
              sería un callejón sin salida — solo se muestra si el usuario
              tiene alguno de los roles que sí tienen destino ahí. */}
          {(hasRole('ADMIN') || hasRole('MOZO')) && (
            // Link (no <a>): navegación client-side, evita el reload
            // completo del navegador — mismo motivo que en admin/layout.tsx.
            // Acá cruza a otro layout (/admin/mesas), así que este layout SÍ
            // se desmonta (no hay sidebar que mantener fijo desde este
            // lado), pero sigue siendo una transición de Next.js, no un
            // reload de browser — no vuelve a pedir todo el JS/CSS ni
            // remonta KeycloakProvider (vive en el layout raíz, por encima
            // de este).
            <Link
              href="/admin/mesas"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-on-surface-variant transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined">arrow_back</span>
              <span className="text-label-md">Volver a admin</span>
            </Link>
          )}
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}