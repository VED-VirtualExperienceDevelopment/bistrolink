'use client';

import { useAlertas } from './AlertasProvider';
import { textoContador } from './alertas.utils';

/**
 * BL-441: contador de pendientes dentro del link «Alertas» del menú lateral.
 * Con el menú completo es un círculo con el número; en el riel de íconos
 * (menú colapsado, desde 1024 px) pasa a ser un punto sobre el ícono. Para los
 * lectores de pantalla se agrega la cantidad al nombre del link («Alertas,
 * 3 pendientes»). El link tiene que ser `relative` para ubicar el punto.
 */
export function ContadorMenuAlertas({
  colapsado,
}: Readonly<{ colapsado: boolean }>) {
  const alertas = useAlertas();
  if (!alertas || alertas.cantidad === 0) return null;

  const { cantidad } = alertas;

  return (
    <>
      <span
        aria-hidden="true"
        className={`ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-error px-1 text-label-md tabular-nums text-on-error ${
          colapsado ? 'lg:hidden' : ''
        }`}
      >
        {textoContador(cantidad)}
      </span>
      <span
        aria-hidden="true"
        className={`absolute right-5 top-2.5 hidden h-2.5 w-2.5 rounded-full bg-error ${
          colapsado ? 'lg:block' : ''
        }`}
      />
      <span className="sr-only">
        , {cantidad === 1 ? '1 pendiente' : `${cantidad} pendientes`}
      </span>
    </>
  );
}
