'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { getKeycloak } from '@/lib/keycloak';

const DEFAULT_REDIRECT = '/admin/usuarios';

/**
 * No es un formulario de credenciales propio — Keycloak es quien las
 * recolecta (Authorization Code + PKCE), como exige RD.07/RF.10. Esta
 * pantalla solo confirma la marca antes de redirigir, y sirve de destino
 * si algo falla en el redirect automático.
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
    if (initializing) return;

    if (authenticated) {
      // Sesión ya activa (detectada por check-sso, o recién autenticada) —
      // avanzar a destino en vez de quedarse mostrando el spinner.
      router.replace(redirectTarget);
      return;
    }

    getKeycloak().login({
      redirectUri: `${window.location.origin}${redirectTarget}`,
    });
  }, [initializing, authenticated, redirectTarget, router]);

  return (
    <main className="flex h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-outline-variant bg-surface-container-lowest p-8 text-center shadow-sm">
        <div className="text-headline-md font-bold leading-tight text-primary">Bistro Link</div>
        <p className="mb-6 text-label-md text-on-surface-variant">Portal de Administración</p>
        <div className="flex items-center justify-center gap-2 text-body-md text-on-surface-variant">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Redirigiendo a inicio de sesión…
        </div>
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