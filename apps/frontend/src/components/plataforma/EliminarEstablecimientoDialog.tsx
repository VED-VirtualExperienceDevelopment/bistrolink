"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { apiFetch, ApiError } from "@/lib/api-client";
import type {
  EstablecimientoAEliminar,
  ResultadoEliminacion,
} from "@/types/plataforma";
import {
  eliminacionIncompleta,
  mensajeErrorEliminacion,
  resumirEliminacion,
  rutCoincide,
  solicitudEliminacion,
} from "./plataforma.utils";
import {
  CLASE_BOTON_PRIMARIO,
  CLASE_BOTON_SECUNDARIO,
} from "./ContrasenaTemporal";

interface Props {
  open: boolean;
  onClose: () => void;
  token: string | undefined;
  establecimiento: EstablecimientoAEliminar;
  /** Texto del botón que cierra después de eliminar («Volver al listado»). */
  textoAlTerminar: string;
  /**
   * Se llama al cerrar una vez eliminado (aunque hayan quedado cuentas por
   * borrar): la ficha vuelve al listado y el listado se recarga.
   */
  onTerminado: () => void;
}

const ID_RUT = "eliminar-rut";

/**
 * BL-418: eliminar definitivamente un establecimiento creado por error, sin
 * actividad (patrón de borrado irreversible).
 *
 * - Explica qué se borra y qué no, y pide escribir el RUT: el botón
 *   «Eliminar» se habilita recién cuando coincide (acepta puntos y guiones).
 *   El foco empieza en «Cancelar».
 * - Si tiene actividad, el backend responde 409 con «suspendelo»; ese
 *   mensaje se muestra tal cual.
 * - Después de eliminar, el diálogo muestra el resultado en un <output>
 *   (que se anuncia) y no se cierra solo. Si quedaron usuarios de Keycloak sin borrar, ofrece «Reintentar», que
 *   repite el mismo DELETE. Cerrarlo, de cualquier forma, llama a
 *   onTerminado: el establecimiento ya no existe.
 *
 * La página lo monta de nuevo cada vez que se abre (key), así no queda el
 * RUT escrito antes.
 */
export function EliminarEstablecimientoDialog({
  open,
  onClose,
  token,
  establecimiento,
  textoAlTerminar,
  onTerminado,
}: Readonly<Props>) {
  const [rut, setRut] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoEliminacion | null>(
    null,
  );
  const botonResultado = useRef<HTMLButtonElement>(null);

  const coincide = rutCoincide(rut, establecimiento.rut);
  const incompleta = resultado ? eliminacionIncompleta(resultado) : false;

  // Al pasar al resultado, el botón que tenía el foco desaparece: el foco va
  // a la acción principal del resultado.
  useEffect(() => {
    if (resultado) botonResultado.current?.focus();
  }, [resultado]);

  const eliminar = async () => {
    setEnviando(true);
    setError(null);
    const { ruta, init } = solicitudEliminacion(
      establecimiento.tenantId,
      establecimiento.rut,
    );
    try {
      setResultado(await apiFetch<ResultadoEliminacion>(ruta, token, init));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? mensajeErrorEliminacion(err.status, err.message)
          : "No se pudo eliminar el establecimiento",
      );
    } finally {
      setEnviando(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!coincide || enviando) return;
    void eliminar();
  };

  // Una vez eliminado, cerrar (también con Escape) es «terminar».
  const cerrar = resultado ? onTerminado : onClose;

  return (
    <Dialog
      open={open}
      onClose={cerrar}
      title={`¿Eliminar ${establecimiento.razonSocial}?`}
    >
      {resultado ? (
        <div className="space-y-4 text-body-md text-on-surface">
          {/* <output> ya tiene el rol status: se anuncia sin mover el foco. */}
          <output
            className={`block rounded-lg px-3 py-2 ${incompleta ? "bg-tertiary-fixed text-on-tertiary-fixed" : "bg-secondary-container text-on-secondary-container"}`}
          >
            {resumirEliminacion(establecimiento.razonSocial, resultado)}
          </output>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            {incompleta ? (
              <>
                <button
                  type="button"
                  onClick={onTerminado}
                  className={CLASE_BOTON_SECUNDARIO}
                >
                  {textoAlTerminar}
                </button>
                <button
                  ref={botonResultado}
                  type="button"
                  onClick={() => void eliminar()}
                  disabled={enviando}
                  className={CLASE_BOTON_PRIMARIO}
                >
                  {enviando ? "Reintentando…" : "Reintentar"}
                </button>
              </>
            ) : (
              <button
                ref={botonResultado}
                type="button"
                onClick={onTerminado}
                className={CLASE_BOTON_PRIMARIO}
              >
                {textoAlTerminar}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 text-body-md text-on-surface"
          noValidate
        >
          <p>
            Es para un alta hecha por error y sin uso. No se puede deshacer.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Se borran el restaurante, sus mesas (también la virtual) y la
              carta.
            </li>
            <li>
              Se borran todos sus usuarios: Administradores, mozos, la cuenta
              de Cocina y la del comensal. Ya no van a poder ingresar.
            </li>
            <li>
              Si el establecimiento tiene algún pedido, no se puede eliminar:
              suspendelo.
            </li>
          </ul>

          <div>
            <label
              htmlFor={ID_RUT}
              className="mb-1 block text-label-md text-on-surface-variant"
            >
              Escribí el RUT para confirmar
            </label>
            <input
              id={ID_RUT}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              aria-describedby={`${ID_RUT}-ayuda`}
              className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p
              id={`${ID_RUT}-ayuda`}
              className="mt-1 text-body-sm text-on-surface-variant"
            >
              El RUT es {establecimiento.rut}. El botón «Eliminar definitivamente»
              se habilita cuando coincide.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              data-autofocus
              className={CLASE_BOTON_SECUNDARIO}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!coincide || enviando}
              className="min-h-12 rounded-lg bg-error px-4 text-body-md font-medium text-on-error hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {enviando ? "Eliminando…" : "Eliminar definitivamente"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
