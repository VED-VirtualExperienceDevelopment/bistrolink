'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useKeycloakAuth } from '@/components/providers/KeycloakProvider';

/**
 * BL-350: quién inició sesión, en el encabezado de admin, KDS y plataforma.
 * Surge de la auditoría: en una tablet compartida del salón o de la caja no
 * quedaba claro con qué usuario se estaba trabajando.
 *
 * - Botón con las iniciales, el nombre y el rol. En el celular se ven solo
 *   las iniciales; el nombre y el rol siguen ahí para el lector de pantalla.
 * - Al tocarlo se abre un panel con el nombre completo, el usuario, el rol y
 *   «Cerrar sesión». Es un desplegable (disclosure): se abre y se cierra con
 *   el botón, con Esc (el foco vuelve al botón) o tocando afuera.
 *
 * Los datos salen del token (BL-349). El correo no se muestra.
 */
export default function UsuarioSesion() {
  const { usuario, logout } = useKeycloakAuth();
  const [abierto, setAbierto] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const idPanel = useId();

  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAbierto(false);
        botonRef.current?.focus();
      }
    };
    const alTocarAfuera = (e: PointerEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener('keydown', alPresionar);
    document.addEventListener('pointerdown', alTocarAfuera);
    return () => {
      document.removeEventListener('keydown', alPresionar);
      document.removeEventListener('pointerdown', alTocarAfuera);
    };
  }, [abierto]);

  if (!usuario) return null;

  const { nombre, nombreUsuario, iniciales, rol } = usuario;
  // El usuario se muestra aparte solo si no es lo mismo que el nombre (pasa
  // cuando el token no trae nombre y apellido).
  const mostrarUsuario = nombreUsuario && nombreUsuario !== nombre;

  return (
    <div ref={contenedorRef} className="relative">
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto((actual) => !actual)}
        aria-expanded={abierto}
        aria-controls={idPanel}
        className="flex min-h-12 items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:pr-3"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary-container text-label-md font-bold text-on-primary"
        >
          {iniciales}
        </span>
        {/* En el celular, solo para el lector de pantalla: el botón conserva
            su nombre aunque se vean solo las iniciales. */}
        <span className="sr-only text-left sm:not-sr-only sm:flex sm:flex-col sm:leading-tight">
          <span className="max-w-[16ch] truncate text-label-md font-semibold text-on-surface">
            {nombre ?? 'Sesión iniciada'}
          </span>
          {rol && (
            <span className="text-label-sm text-on-surface-variant">
              {rol}
            </span>
          )}
        </span>
      </button>

      <div
        id={idPanel}
        hidden={!abierto}
        className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-lg"
      >
        <p className="break-words text-body-lg font-semibold text-on-surface">
          {nombre ?? 'Sesión iniciada'}
        </p>
        {mostrarUsuario && (
          <p className="mt-1 break-words text-label-md text-on-surface-variant">
            Usuario: {nombreUsuario}
          </p>
        )}
        {rol && (
          <p className="mt-2">
            <span className="inline-flex rounded-full bg-secondary-container px-3 py-1 text-label-md text-on-secondary-container">
              {rol}
            </span>
          </p>
        )}
        <button
          type="button"
          onClick={logout}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-outline-variant px-4 text-label-md font-semibold text-on-surface transition-colors hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
                <span aria-hidden="true" className="material-symbols-outlined">
            logout
          </span>
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  );
}
