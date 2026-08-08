'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';

const NAV_ITEMS = [
  { href: '/admin/usuarios', label: 'Usuarios', icon: 'group' },
  // Próximos módulos (HU-001, HU-003, etc.) se suman acá a medida que
  // existan pantallas reales — evitamos linkear secciones que no existen.
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { initializing, authenticated, hasRole, logout } = useKeycloakAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (initializing) return;
    if (!authenticated) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!hasRole('ADMIN')) {
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

  if (!authenticated || !hasRole('ADMIN')) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden md:flex w-64 h-screen flex-col shrink-0 border-r border-outline-variant bg-surface-container-lowest">
        <div className="p-6">
          <div className="text-headline-md font-bold leading-tight text-primary">Bistro Link</div>
          <div className="text-label-md text-on-surface-variant">Management Suite</div>
        </div>

        <nav className="mt-4 flex-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 transition-colors duration-200 ${
                  active
                    ? 'border-l-4 border-primary bg-secondary-container text-on-secondary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span className="text-label-md">{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-outline-variant p-2">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined">logout</span>
            <span className="text-label-md">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 w-full shrink-0 items-center justify-between border-b border-outline-variant bg-surface px-6 shadow-sm">
          <div className="md:hidden text-headline-sm font-bold text-primary">Bistro Link</div>
          <div />
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