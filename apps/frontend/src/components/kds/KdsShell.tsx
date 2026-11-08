'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import UsuarioSesion from '@/components/sesion/UsuarioSesion';

const ROLES_PERMITIDOS = ['ADMIN', 'COCINA', 'MOZO'];

  /**
   * BL-224: guard y encabezado de /kds. Antes era app/kds/layout.tsx; pasó a
   * componente porque un layout con 'use client' no puede exportar `metadata`.
   */
  export default function KdsShell({
    children,
  }: Readonly<{ children: React.ReactNode }>) {
  const { initializing, authenticated, hasRole } = useKeycloakAuth();
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
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-4 shadow-sm md:px-6">
        <div className="text-headline-sm font-bold text-primary">BistroLink — KDS</div>
        <div className="flex items-center gap-2">
          {/* Sin link "volver a admin": ADMIN/MOZO ya tienen /admin/kds
              (embebido, con sidebar) para ver/operar esto sin salir de
              admin — este standalone es la pantalla dedicada de COCINA, que
              no tiene destino del lado admin al cual volver. Si alguien
              entra acá directo con otro rol, el «Cerrar sesión» de abajo
              alcanza.
              BL-350: el botón de logout (solo un ícono, sin nombre para el
              lector de pantalla) pasa a estar dentro de UsuarioSesion, junto
              con quién inició sesión. */}
          <UsuarioSesion />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
