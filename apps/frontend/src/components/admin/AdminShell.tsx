'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';

const NAV_ITEMS = [
  // `roles: undefined` = visible para cualquier staff (ADMIN o MOZO).
  { href: '/admin/usuarios', label: 'Usuarios', icon: 'group', roles: ['ADMIN'] },
  { href: '/admin/mesas', label: 'Mapa de mesas', icon: 'table_restaurant' },
  // Apunta a /admin/kds (embebido, con sidebar), no a /kds standalone.
  // /kds sigue existiendo intacto como pantalla completa dedicada a COCINA
  // (que no es "esStaff" acá, no entra a /admin/* en absoluto) y para
  // cualquiera que prefiera abrirla directo — /admin/kds reusa el mismo
  // componente <KdsBoard /> con el mismo nivel de interacción, solo que
  // embebido dentro de este layout para que ADMIN/MOZO no tengan que salir
  // de /admin para verlo.
  { href: '/admin/kds', label: 'KDS', icon: 'skillet' },
  // Gestión de Carta - Administración del menú (categorías, ítems, disponibilidad)
  { href: '/admin/menu', label: 'Gestión de Carta', icon: 'restaurant_menu' },
  // Próximos módulos (HU-001, HU-003, etc.) se suman acá a medida que
  // existan pantallas reales — evitamos linkear secciones que no existen.
];

// Menú lateral que se puede esconder. Desde 1024 px (corte `lg`) alterna
// entre completo y un riel de íconos, y la preferencia se recuerda en este
// navegador (es solo una comodidad visual, no lleva datos del usuario). Por
// debajo es un panel deslizable que arranca cerrado: el contenido usa todo
// el ancho y el menú queda a un toque (antes, debajo de 768 px no había
// forma de navegar).
const CLAVE_MENU_COLAPSADO = 'bistrolink.admin.menuColapsado';
const CONSULTA_ESCRITORIO = '(min-width: 1024px)';

/**
 * BL-224: guard y estructura (sidebar y encabezado) de /admin/*. Antes era
 * app/admin/layout.tsx; pasó a componente porque un layout con 'use client'
 * no puede exportar `metadata` (el título de la pestaña). El layout de
 * servidor lo envuelve y declara el título.
 */
export default function AdminShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { initializing, authenticated, hasRole, logout } = useKeycloakAuth();
  const router = useRouter();
  const pathname = usePathname();

  // BL-160: este layout envuelve la totalidad de /admin/* (usuarios, mesas, y lo que se
  // sume después). Antes de BL-160 era ADMIN-only porque la única pantalla
  // era gestión de usuarios. Con /admin/mesas sumamos un caso legítimo de
  // acceso de Colaborador (Mozo) — solo lectura del mapa, ver
  // MapaMesasEditor.tsx — así que el guard de acá pasa a ser "cualquier
  // staff" (ADMIN o MOZO) y las pantallas que deben seguir siendo
  // admin-exclusivas (como /admin/usuarios) agregan su PROPIO guard más
  // estricto — mismo patrón que ya usa MapaMesasEditor con `puedeEditar`.
  const esStaff = hasRole('ADMIN') || hasRole('MOZO');

  useEffect(() => {
    if (initializing) return;
    if (!authenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!esStaff) {
      router.replace('/');
    }
  }, [initializing, authenticated, esStaff, router, pathname]);

  // Estado del menú. Va antes de los return de abajo: los hooks no pueden
  // quedar después de un return condicional.
  const [esEscritorio, setEsEscritorio] = useState(false);
  const [colapsado, setColapsado] = useState(false);
  const [abiertoMovil, setAbiertoMovil] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_ESCRITORIO);
    setEsEscritorio(consulta.matches);
    const alCambiar = (e: MediaQueryListEvent) => {
      setEsEscritorio(e.matches);
      if (e.matches) setAbiertoMovil(false);
    };
    consulta.addEventListener('change', alCambiar);
    try {
      setColapsado(localStorage.getItem(CLAVE_MENU_COLAPSADO) === '1');
    } catch {
      // Sin acceso al almacenamiento (modo privado): queda el menú completo.
    }
    return () => consulta.removeEventListener('change', alCambiar);
  }, []);

  // Al elegir una sección en el celular, el panel se cierra solo.
  useEffect(() => {
    setAbiertoMovil(false);
  }, [pathname]);

  // Esc cierra el panel deslizable.
  useEffect(() => {
    if (!abiertoMovil) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbiertoMovil(false);
    };
    document.addEventListener('keydown', alPresionar);
    return () => document.removeEventListener('keydown', alPresionar);
  }, [abiertoMovil]);

  function alternarMenu() {
    if (!esEscritorio) {
      setAbiertoMovil((abierto) => !abierto);
      return;
    }
    setColapsado((actual) => {
      const nuevo = !actual;
      try {
        localStorage.setItem(CLAVE_MENU_COLAPSADO, nuevo ? '1' : '0');
      } catch {
        // Si no se puede guardar, el cambio vale igual para esta visita.
      }
      return nuevo;
    });
  }

  const menuVisible = esEscritorio ? !colapsado : abiertoMovil;

  if (initializing) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!authenticated || !esStaff) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Velo del panel en pantallas angostas. Es un <button> y no un <div>
          con onClick por la misma regla de accesibilidad que Dialog.tsx;
          tabIndex -1 porque con teclado alcanza con Esc. */}
      {abiertoMovil && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Cerrar el menú"
          onClick={() => setAbiertoMovil(false)}
          className="fixed inset-0 z-30 bg-on-surface/40 lg:hidden"
        />
      )}
      {/* Debajo de 1024 px el menú es fixed, fuera de la pantalla e
          invisible (invisible lo saca del orden de Tab y del lector de
          pantalla mientras está cerrado). Desde 1024 px vuelve a ser static
          y el ancho depende de `colapsado`; todas esas clases llevan lg:, así
          que el panel del celular siempre se ve completo. */}
      <aside
        id="menu-admin"
        aria-label="Menú principal"
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col border-r border-outline-variant bg-surface-container-lowest transition-[transform,width] duration-200 lg:static lg:z-auto lg:translate-x-0 lg:visible lg:shadow-none ${
          abiertoMovil
            ? 'visible translate-x-0 shadow-2xl'
            : 'invisible -translate-x-full'
        } ${colapsado ? 'lg:w-[72px]' : 'lg:w-64'}`}
      >
        <div className={`p-6 ${colapsado ? 'lg:hidden' : ''}`}>
          <div className="text-headline-md font-bold leading-tight text-primary">
            BistroLink
          </div>
          <div className="text-label-md text-on-surface-variant">
            Portal de Administración
          </div>
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto">
          {NAV_ITEMS.filter(
            (item) => !item.roles || item.roles.some((rol) => hasRole(rol)),
          ).map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              // Link (no <a>): navegación client-side de Next.js. Con <a>
              // plano cada click disparaba una recarga completa del
              // navegador — remontaba el árbol de React, incluido el
              // KeycloakProvider del layout raíz y este mismo sidebar, que
              // por eso "parpadeaba"/tardaba en cada cambio de pestaña. Con
              // Link, este layout (sidebar incluido) queda montado fijo y
              // Next.js solo intercambia el contenido de <main> — no hay
              // ninguna razón de sesión/auth para forzar el reload completo,
              // KeycloakProvider vive en layout.tsx (raíz), no acá.
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={colapsado ? item.label : undefined}
                className={`flex items-center gap-3 px-4 py-3 transition-colors duration-200 ${
                  colapsado ? 'lg:justify-center lg:px-0' : ''
                } ${
                  active
                    ? 'border-l-4 border-primary bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <span aria-hidden="true" className="material-symbols-outlined">
                  {item.icon}
                </span>
                {/* En el riel el texto se esconde a la vista, pero el lector
                    de pantalla lo sigue leyendo: el link conserva su nombre. */}
                <span
                  className={`text-label-md ${colapsado ? 'lg:sr-only' : ''}`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-outline-variant p-2">
          <button
            type="button"
            onClick={logout}
            title={colapsado ? 'Cerrar sesión' : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-on-surface-variant transition-colors hover:bg-surface-container-low ${
              colapsado ? 'lg:justify-center lg:px-0' : ''
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              logout
            </span>
            <span className={`text-label-md ${colapsado ? 'lg:sr-only' : ''}`}>
              Cerrar sesión
            </span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 w-full shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-2 shadow-sm md:px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={alternarMenu}
              aria-controls="menu-admin"
              aria-expanded={menuVisible}
              aria-label={menuVisible ? 'Ocultar el menú' : 'Mostrar el menú'}
              title={menuVisible ? 'Ocultar el menú' : 'Mostrar el menú'}
              className="flex min-h-12 min-w-12 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span aria-hidden="true" className="material-symbols-outlined">
                {menuVisible ? 'menu_open' : 'menu'}
              </span>
            </button>
            <div className="text-headline-sm font-bold text-primary lg:hidden">
              BistroLink
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="material-symbols-outlined rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-low">
              notifications
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
