'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { getKeycloak } from '@/lib/keycloak';

// Antes hardcodeaba '/admin/usuarios' (ADMIN-only) — un MOZO/COCINA que
// logueaba sin ?redirect= (ej. entrando directo a la URL del sitio) caía
// ahí, ese layout lo rebotaba por no tener el rol, y terminaba en el
// placeholder de Next.js. Ahora apunta a '/', que decide el destino según
// el rol del usuario (ver page.tsx) en vez de asumir ADMIN.
const DEFAULT_REDIRECT = '/';

/**
 * No es un formulario de credenciales propio — Keycloak es quien las
 * recolecta (Authorization Code + PKCE), como exige RD.07/RF.10. Esta
 * pantalla confirma la marca y requiere un click explícito antes de ir a
 * Keycloak.
 *
 * BL-180: antes disparaba login() automáticamente al montar, sin que hubiera
 * tiempo real de cancelar (el redirect a Keycloak es casi instantáneo, así
 * que un link "Cancelar" en esa pantalla nunca llegaba a verse ni a poder
 * clickearse — confirmado probándolo). Ahora el click en "Ingresar" es lo
 * único que dispara login(): sin carrera contra ningún redirect automático,
 * "Cancelar" siempre está disponible, y el botón "atrás" del navegador desde
 * Keycloak vuelve a esta misma pantalla quieta en vez de re-loguear solo.
 *
 * IMPORTANTE: sin especificar redirectUri, keycloak-js usa por default la
 * URL actual (o sea, esta misma página /login) como destino post-login —
 * eso hacía que, tras autenticarse, Keycloak devolviera acá en loop en vez
 * de a la pantalla que el usuario quería ver originalmente. Por eso
 * AdminShell (admin/layout.tsx) pasa la ruta de origen como ?redirect=...,
 * y acá se la pasamos de vuelta a login() como redirectUri explícito.
 */
function LoginRedirect() {
  const { initializing, authenticated } = useKeycloakAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get('redirect') || DEFAULT_REDIRECT;

  useEffect(() => {
    if (initializing || !authenticated) return;

    // Sesión ya activa (detectada por check-sso, o recién autenticada) —
    // avanzar a destino en vez de quedarse mostrando el botón de ingresar.
    router.replace(redirectTarget);
  }, [initializing, authenticated, redirectTarget, router]);

  const handleIngresar = () => {
    getKeycloak().login({
      redirectUri: `${window.location.origin}${redirectTarget}`,
    });
  };

  if (initializing || authenticated) {
    return (
      <main className="flex h-screen items-center justify-center bg-background px-4">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="flex h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-sm">
        <div className="text-headline-md font-bold leading-tight text-primary">Bistro Link</div>
        <p className="mb-6 text-label-md text-on-surface-variant">Portal de Administración</p>

        <button
          type="button"
          onClick={handleIngresar}
          className="w-full rounded-lg bg-primary px-4 py-2.5 text-body-md font-medium text-on-primary hover:opacity-90"
        >
          Ingresar
        </button>

        <Link
          href="/"
          className="mt-4 inline-block text-label-md text-on-surface-variant underline underline-offset-2 hover:text-primary"
        >
          Cancelar
        </Link>
      </div>
    </main>
  );
}

// useSearchParams exige un límite de Suspense alrededor en App Router.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginRedirect />
    </Suspense>
  );
}