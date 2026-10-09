"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";

/**
 * BL-163 (HU-027): pantalla del equipo de BistroLink (rol PLATAFORMA) para
 * dar de alta establecimientos. Mismo patrón que kds/layout.tsx: sin sesión
 * va a /login; con sesión pero sin el rol, a "/".
 *
 * Este guard solo ordena la navegación: quien decide es el backend. Los
 * endpoints /plataforma/* aceptan únicamente tokens con rol PLATAFORMA y sin
 * tenant_id (PlataformaJwtStrategy), y un token PLATAFORMA no sirve en
 * ninguna ruta de un restaurante.
 */
export default function PlataformaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { initializing, authenticated, hasRole, logout } = useKeycloakAuth();
  const router = useRouter();
  const pathname = usePathname();
  const esPlataforma = hasRole("PLATAFORMA");

  useEffect(() => {
    if (initializing) return;
    if (!authenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!esPlataforma) {
      router.replace("/");
    }
  }, [initializing, authenticated, esPlataforma, router, pathname]);

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authenticated || !esPlataforma) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-6 shadow-sm">
        <div>
          <div className="text-headline-sm font-bold text-primary">
            Bistro Link
          </div>
          <div className="text-label-md text-on-surface-variant">
            Plataforma
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            logout
          </span>
          <span className="text-label-md">Cerrar sesión</span>
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
