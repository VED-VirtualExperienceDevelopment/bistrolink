"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import BarraGuardar from "@/components/admin/configuracion/BarraGuardar";
import {
  CLASE_AYUDA,
  CLASE_ERROR_GENERAL,
} from "@/components/admin/configuracion/configuracion.estilos";
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

const FORM_ID = "form-stock";

/**
 * HU-015 (BL-120): stock de la jornada. Al empezar el turno, el
 * administrador marca qué ítems controlan stock y carga cuántas unidades hay
 * y con cuántas avisar. Con control de stock, el ítem sale de la carta al
 * llegar a 0 y vuelve al reponer; la campana del header avisa cuando quedan
 * pocas. Un solo «Guardar cambios» manda todos los cambios. Solo
 * Administrador (el backend responde 403 a los demás roles).
 *
 * BL-474: mismo layout que Configuración (BL-473). Ocupa todo el ancho del
 * panel (dos columnas de categorías desde 1536 px) y la barra de guardado
 * va al final, fija abajo, sin espacio vacío debajo.
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

  function descartar() {
    setIntentoGuardar(false);
    estado.descartar();
  }

  // Los errores se ven al intentar guardar, no mientras se escribe.
  const erroresVisibles = intentoGuardar ? errores : {};
  const conItems = items !== null && items.length > 0;

  return (
    <div className="flex min-h-full w-full flex-col px-4 pt-4 md:px-6 md:pt-6 lg:px-8 lg:pt-8">
      <div className="w-full flex-1 space-y-6 pb-6">
        <header className="space-y-1">
          <h1 className="text-headline-lg text-primary">Stock de la jornada</h1>
          <p className="text-body-md text-on-surface-variant">
            Marcá los ítems que se terminan y cargá cuántas unidades hay. Al
            llegar a 0 el ítem sale de la carta, y la campana te avisa cuando
            quedan pocas.
          </p>
        </header>

        {estado.errorCarga && (
          <p role="alert" className={CLASE_ERROR_GENERAL}>
            {estado.errorCarga}
          </p>
        )}

        {!items && !estado.errorCarga && (
          <output className={`block ${CLASE_AYUDA}`}>
            Cargando el stock…
          </output>
        )}

        {items?.length === 0 && (
          <p className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-6 text-center text-body-md text-on-surface-variant">
            La carta no tiene ítems todavía. Agregalos en Gestión de Carta.
          </p>
        )}

        {conItems && (
          <>
            <p className="text-body-md text-on-surface-variant">
              {resumen.controlados} con control de stock · {resumen.porAgotarse}{" "}
              por agotarse · {resumen.agotados}{" "}
              {resumen.agotados === 1 ? "agotado" : "agotados"}
            </p>

            <form
              id={FORM_ID}
              onSubmit={guardar}
              noValidate
              aria-label="Stock de la jornada por ítem"
              className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-2"
            >
              {grupos.map((grupo) => (
                <TablaStockCategoria
                  key={grupo.categoria.id}
                  grupo={grupo}
                  formulario={formulario}
                  errores={erroresVisibles}
                  onCambiar={estado.cambiarFila}
                />
              ))}
            </form>
          </>
        )}
      </div>

      {/* BL-474: la barra de Configuración, al final y fija abajo. Anuncia
          los cambios pendientes y el resultado del guardado (aria-live). */}
      {conItems && (
        <BarraGuardar
          formId={FORM_ID}
          conCambios={pendientes > 0}
          textoCambios={textoPendientes(pendientes)}
          guardando={estado.guardando}
          aviso={estado.aviso}
          error={estado.errorGuardar}
          onDescartar={descartar}
        />
      )}
    </div>
  );
}
