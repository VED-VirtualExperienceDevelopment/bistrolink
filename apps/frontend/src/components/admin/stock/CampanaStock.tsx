"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import ReponerStockDialog from "./ReponerStockDialog";
import { useAlertasStock } from "./useAlertasStock";
import {
  colorBadge,
  ETIQUETA_TIPO,
  etiquetaCampana,
  siguienteIndice,
  textoBadge,
  textoSinStock,
  textoUnidades,
  type AlertaStock,
} from "./stock.utils";

// Contraste: texto oscuro sobre ámbar (≥ 7:1) y blanco sobre rojo (≥ 4.5:1).
const CLASE_BADGE = {
  ambar: "bg-amber-400 text-amber-950",
  rojo: "bg-error text-on-error",
} as const;
const CLASE_ESTADO = {
  STOCK_CRITICO: "bg-amber-100 text-amber-900",
  AGOTADO: "bg-error-container text-on-error-container",
} as const;

/**
 * HU-015 (BL-120): campana de alertas de stock en el header, al lado del
 * usuario. Solo para el Administrador (la monta AdminShell).
 *
 * - Botón con el total de ítems críticos en el nombre accesible y un badge
 *   ámbar (por agotarse) o rojo (algún agotado).
 * - Menú con flechas, Inicio y Fin; Escape lo cierra y devuelve el foco a la
 *   campana; Tab o un clic afuera lo cierran.
 * - Cada alerta abre «Reponer stock» sin salir de la pantalla.
 * - Las alertas nuevas se anuncian en una región aria-live, sin mover el
 *   foco.
 */
export default function CampanaStock() {
  const { alertas, sinStock, anuncio, reponer } = useAlertasStock(true);
  const [abierto, setAbierto] = useState(false);
  const [reponiendo, setReponiendo] = useState<AlertaStock | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const idMenu = useId();
  const color = colorBadge(alertas);

  // Al abrir, el foco va a la primera alerta.
  useEffect(() => {
    if (abierto) itemsRef.current[0]?.focus();
  }, [abierto]);

  // Un clic afuera cierra el menú.
  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: MouseEvent) => {
      if (!contenedorRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", alClic);
    return () => document.removeEventListener("mousedown", alClic);
  }, [abierto]);

  function cerrar(devolverFoco: boolean) {
    setAbierto(false);
    if (devolverFoco) botonRef.current?.focus();
  }

  function alPresionar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar(true);
      return;
    }
    if (e.key === "Tab") {
      setAbierto(false);
      return;
    }
    const actual = itemsRef.current.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const siguiente = siguienteIndice(actual, alertas.length, e.key);
    if (siguiente !== null) {
      e.preventDefault();
      itemsRef.current[siguiente]?.focus();
    }
  }

  return (
    <div ref={contenedorRef} className="relative">
      <button
        ref={botonRef}
        type="button"
        onClick={() => setAbierto(!abierto)}
        aria-label={etiquetaCampana(alertas)}
        aria-haspopup="true"
        aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined}
        className="relative flex min-h-12 min-w-12 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span aria-hidden="true" className="material-symbols-outlined">
          notifications
        </span>
        {color && (
          <span
            aria-hidden="true"
            className={`absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-label-sm ${CLASE_BADGE[color]}`}
          >
            {textoBadge(alertas.length)}
          </span>
        )}
      </button>

      {abierto && (
        <div
          id={idMenu}
          onKeyDown={alPresionar}
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-outline-variant bg-surface-container-lowest shadow-lg"
        >
          <p className="border-b border-outline-variant px-4 py-3 text-label-md text-on-surface-variant">
            Stock
          </p>
          {alertas.length === 0 ? (
            <p className="px-4 py-6 text-center text-body-md text-on-surface-variant">
              No hay ítems por agotarse.
            </p>
          ) : (
            <ul
              role="menu"
              aria-label="Alertas de stock"
              className="max-h-96 overflow-y-auto py-1"
            >
              {alertas.map((alerta, i) => (
                <li key={alerta.itemId} role="none">
                  <button
                    ref={(el) => {
                      itemsRef.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => {
                      setReponiendo(alerta);
                      setAbierto(false);
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-container-low focus:bg-surface-container-low focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-md text-on-surface">
                        {alerta.nombre}
                      </span>
                      <span className="block text-body-sm text-on-surface-variant">
                        {textoUnidades(alerta)}
                      </span>
                      {sinStock[alerta.itemId] && (
                        <span className="block text-body-sm text-error">
                          {textoSinStock(sinStock[alerta.itemId])}
                        </span>
                      )}
                      <span className="mt-1 block text-body-sm text-primary">
                        Reponer stock
                      </span>
                    </span>
                    <span
                      className={`flex-none rounded-full px-2 py-0.5 text-label-sm ${CLASE_ESTADO[alerta.tipo]}`}
                    >
                      {ETIQUETA_TIPO[alerta.tipo]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>

      <ReponerStockDialog
        alerta={reponiendo}
        onClose={() => {
          setReponiendo(null);
          botonRef.current?.focus();
        }}
        onGuardar={reponer}
      />
    </div>
  );
}
