'use client';

import { useEffect } from 'react';
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
          {/* Sin link "volver a admin": ADMIN/MOZO ya tienen /admin/kds
              (embebido, con sidebar) para ver/operar esto sin salir de
              admin — este standalone es la pantalla dedicada de COCINA, que
              no tiene destino del lado admin al cual volver. Si alguien
              entra acá directo con otro rol, el logout de abajo alcanza. */}
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