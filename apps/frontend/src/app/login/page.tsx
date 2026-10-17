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

/** Anillo de foco visible, igual que en el tema de Keycloak. */
const FOCO =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary-container';

/**
 * BL-348: beneficios del panel de marca. Mismos textos e íconos que el tema
 * de login de Keycloak (keycloak/themes/bistrolink/login, BL-347), para que
 * el paso de esta pantalla a Keycloak no se note. Si cambian acá, cambiarlos
 * también en messages_es.properties del tema.
 */
const BENEFICIOS = [
  {
    texto: 'Los pedidos de cada mesa llegan al instante a la cocina.',
    icono:
      'M2 17h20v2H2zm11.84-9.21c.1-.24.16-.51.16-.79 0-1.1-.9-2-2-2s-2 .9-2 2c0 .28.06.55.16.79C6.25 8.6 3.27 11.93 3 16h18c-.27-4.07-3.25-7.4-7.16-8.21z',
  },
  {
    texto: 'El mapa del salón muestra el estado de cada mesa.',
    icono:
      'M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z',
  },
  {
    texto: 'Los comensales pagan desde la mesa, sin esperar la cuenta.',
    icono:
      'M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z',
  },
];

/**
 * Panel de marca. Desde 1024 px (lg) es la columna izquierda, a toda la
 * altura; debajo es un encabezado compacto, sin los beneficios.
 */
function PanelMarca() {
  return (
    <aside
      aria-labelledby="bl-marca-nombre"
      className="bg-[linear-gradient(160deg,#381e72_0%,#4f378a_100%)] px-4 py-5 text-on-primary lg:flex lg:flex-col lg:justify-center lg:px-[clamp(40px,5vw,96px)] lg:py-16"
    >
      <p
        id="bl-marca-nombre"
        className="flex items-center gap-2.5 text-[28px] font-extrabold leading-tight lg:text-[40px]"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          className="h-8 w-8 flex-none fill-tertiary-fixed-dim lg:h-11 lg:w-11"
        >
          <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z" />
        </svg>
        BistroLink
      </p>
      <p className="mt-1 text-[15px] font-semibold text-primary-fixed lg:text-[18px]">
        Portal del personal
      </p>
      <p className="mt-3 text-[17px] font-bold leading-snug text-tertiary-fixed-dim lg:mt-8 lg:max-w-[18ch] lg:text-[28px]">
        Pedí y pagá desde la mesa, sin esperas.
      </p>
      <ul className="mt-10 hidden max-w-[40ch] gap-5 lg:grid">
        {BENEFICIOS.map(({ texto, icono }) => (
          <li
            key={texto}
            className="flex items-center gap-3.5 text-[16px] font-medium leading-snug"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-full bg-tertiary-fixed-dim"
            >
              <svg
                viewBox="0 0 24 24"
                focusable="false"
                className="h-[22px] w-[22px] fill-on-tertiary-fixed"
              >
                <path d={icono} />
              </svg>
            </span>
            {texto}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * No es un formulario de credenciales propio — Keycloak es quien las
 * recolecta (Authorization Code + PKCE), como exige RD.07/RF.10. Esta
 * pantalla confirma la marca y requiere un click explícito antes de ir a
 * Keycloak.
 *
 * BL-348: mismo diseño en dos columnas que el login de Keycloak (BL-347).
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
        <span
          role="status"
          className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
        >
          <span className="sr-only">Cargando…</span>
        </span>
      </main>
    );
  }

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-background lg:grid-cols-[minmax(380px,5fr)_7fr] lg:grid-rows-1">
      <PanelMarca />

      <main className="flex flex-col items-center px-4 py-6 lg:justify-center lg:px-8 lg:py-12">
        <div className="w-full max-w-[440px] rounded-xl border border-outline-variant bg-surface-container-lowest px-5 py-6 shadow-[0_4px_20px_rgba(0,0,0,0.08)] lg:px-9 lg:py-10">
          <h1 className="text-[24px] font-bold leading-tight text-on-surface lg:text-[28px]">
            Ingresá a BistroLink
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-on-surface-variant">
            Vas a ingresar tu usuario y contraseña en la pantalla segura de
            BistroLink.
          </p>

          <button
            type="button"
            onClick={handleIngresar}
            className={`mt-6 min-h-12 w-full rounded-full bg-primary-container px-4 text-[16px] font-bold text-on-primary hover:bg-primary ${FOCO}`}
          >
            Ingresar
          </button>

          <div className="mt-2 text-center">
            <Link
              href="/"
              className={`inline-flex min-h-12 items-center px-2 text-[15px] text-primary-container underline underline-offset-2 hover:text-primary ${FOCO}`}
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      </main>
    </div>
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
