'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';
import { esRolDeStaff, resolverDestinoLanding } from './landing.utils';

// "/" nunca se muestra en sí misma: es solo un router que decide a dónde
// mandar a cada usuario. Es un panel interno de staff, no necesita landing
// pública/marketing — los comensales entran por QR a /m/[tenantId], nunca
// pasan por acá.
//
// Prioridad de rol cuando el usuario tiene más de uno (ej. un ADMIN que
// también tiene MOZO): ADMIN > MOZO > COCINA. Cada uno va a su pantalla
// operativa principal ya existente.
export default function Home() {
  const { initializing, authenticated, hasRole } = useKeycloakAuth();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return;

    if (!authenticated) {
      router.replace('/login');
      return;
    }

    // Prioridad de rol y destino final: ver resolverDestinoLanding
    // (landing.utils.ts) — separada en función pura y con test unitario
    // propio (test/unitarios/landing.utils.spec.ts) porque es una decisión
    // que puede regresionar en silencio (ej. alguien reordena los if) sin
    // que se note hasta que un usuario con doble rol cae en la pantalla
    // equivocada.
    const destino = resolverDestinoLanding(hasRole);
    if (destino) {
      router.replace(destino);
    }
    // Si no tiene ninguno de los 3 roles de staff, no redirige — se queda
    // en el mensaje de "sin acceso" de abajo en vez de generar un loop con
    // /login (login con check-sso ya autenticado te manda de vuelta acá).
  }, [initializing, authenticated, hasRole, router]);

  if (initializing || !authenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const tieneRolDeStaff = esRolDeStaff(hasRole);

  if (tieneRolDeStaff) {
    // Redirect en curso (ver useEffect) — evita el flash del mensaje de
    // abajo mientras el router.replace() todavía no se aplicó.
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
      <div className="text-headline-sm font-bold text-primary">Bistro Link</div>
      <p className="text-body-md text-on-surface-variant">
        Tu usuario no tiene un rol de staff asignado. Contactá a un administrador.
      </p>
    </div>
  );
}
