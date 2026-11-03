"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import TablaStockCategoria from "@/components/admin/stock/TablaStockCategoria";
import { useStockJornada } from "@/components/admin/stock/useStockJornada";
import {
  agruparPorCategoria,
  erroresDelFormulario,
  filasConCambios,
  primerCampoConError,
  resumenStock,
  textoPendientes,
} from "@/components/admin/stock/stock-jornada.utils";

const CLASE_BOTON =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 text-body-md font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50";

/**
 * HU-015 (BL-120): stock de la jornada. Al empezar el turno, el
 * administrador marca qué ítems controlan stock y carga cuántas unidades hay
 * y con cuántas avisar. Con control de stock, el ítem sale de la carta al
 * llegar a 0 y vuelve al reponer; la campana del header avisa cuando quedan
 * pocas. Un solo «Guardar» manda todos los cambios. Solo Administrador (el
 * backend responde 403 a los demás roles).
 */
export default function StockPage() {
  const { hasRole } = useKeycloakAuth();
  const router = useRouter();
  const esAdmin = hasRole("ADMIN");

  useEffect(() => {
    if (!esAdmin) router.replace("/admin/mesas");
  }, [esAdmin, router]);

  const estado = useStockJornada(esAdmin);
  const { items, formulario } = estado;
  const [intentoGuardar, setIntentoGuardar] = useState(false);

  const grupos = useMemo(() => agruparPorCategoria(items ?? []), [items]);
  const errores = useMemo(() => erroresDelFormulario(formulario), [formulario]);
  const pendientes = useMemo(
    () => (items ? filasConCambios(items, formulario) : 0),
    [items, formulario],
  );
  const resumen = useMemo(() => resumenStock(items ?? []), [items]);

  if (!esAdmin) return null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setIntentoGuardar(true);
    const campo = primerCampoConError(items ?? [], errores);
    if (campo) {
      document.getElementById(campo)?.focus();
      return;
    }
    await estado.guardar();
    setIntentoGuardar(false);
  }

  // Los errores se ven al intentar guardar, no mientras se escribe.
  const erroresVisibles = intentoGuardar ? errores : {};

  return (
    <div className="w-full max-w-5xl space-y-6 p-4 pb-28 md:p-6 md:pb-28">
      <div>
        <h1 className="text-headline-lg text-primary">Stock de la jornada</h1>
        <p className="text-body-md text-on-surface-variant">
          Marcá los ítems que se terminan y cargá cuántas unidades hay. Al
          llegar a 0 el ítem sale de la carta, y la campana te avisa cuando
          quedan pocas.
        </p>
      </div>

      {estado.errorCarga && (
        <p
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {estado.errorCarga}
        </p>
      )}

      {!items && !estado.errorCarga && (
        <p className="text-body-md text-on-surface-variant" aria-live="polite">
          Cargando el stock…
        </p>
      )}

      {items && items.length === 0 && (
        <p className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-6 text-center text-body-md text-on-surface-variant">
          La carta no tiene ítems todavía. Agregalos en Gestión de Carta.
        </p>
      )}

      {items && items.length > 0 && (
        <form onSubmit={guardar} noValidate className="space-y-4">
          <p className="text-body-md text-on-surface-variant">
            {resumen.controlados} con control de stock · {resumen.porAgotarse}{" "}
            por agotarse · {resumen.agotados}{" "}
            {resumen.agotados === 1 ? "agotado" : "agotados"}
          </p>

          {grupos.map((grupo) => (
            <TablaStockCategoria
              key={grupo.categoria.id}
              grupo={grupo}
              formulario={formulario}
              errores={erroresVisibles}
              onCambiar={estado.cambiarFila}
            />
          ))}

          {/* Barra fija abajo: con cartas largas, Guardar siempre a mano. */}
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-outline-variant bg-surface px-4 py-3 md:-mx-6 md:px-6">
            <p className="mr-auto text-body-sm text-on-surface-variant">
              {textoPendientes(pendientes)}
            </p>
            {estado.errorGuardar && (
              <p role="alert" className="w-full text-body-sm text-error">
                {estado.errorGuardar}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setIntentoGuardar(false);
                estado.descartar();
              }}
              disabled={pendientes === 0 || estado.guardando}
              className={`${CLASE_BOTON} border border-outline-variant text-on-surface hover:bg-surface-container-low`}
            >
              Descartar
            </button>
            <button
              type="submit"
              disabled={pendientes === 0 || estado.guardando}
              className={`${CLASE_BOTON} bg-primary text-on-primary hover:opacity-90`}
            >
              {estado.guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      )}

      <p className="sr-only" aria-live="polite">
        {estado.aviso}
      </p>
    </div>
  );
}
