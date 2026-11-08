"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { EstablecimientosTable } from "@/components/plataforma/EstablecimientosTable";
import { AltaEstablecimientoDialog } from "@/components/plataforma/AltaEstablecimientoDialog";
import { BuscarEstablecimientos } from "@/components/plataforma/BuscarEstablecimientos";
import { EliminarEstablecimientoDialog } from "@/components/plataforma/EliminarEstablecimientoDialog";
import {
  describirCriterio,
  mensajeDeError,
  resumirPagina,
  rutaListado,
  totalPaginas,
} from "@/components/plataforma/plataforma.utils";
import type {
  EstablecimientoListado,
  FiltroEstado,
  PaginaEstablecimientos,
} from "@/types/plataforma";

// BL-405: botones de 48 px (como Usuarios, BL-364, y el mapa, BL-335).
const CLASE_BOTON_PAGINA =
  "flex min-h-12 items-center gap-1 rounded-lg px-3 text-body-md hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40";

/**
 * BL-406: espera entre la última tecla y el pedido al servidor. Evita un
 * pedido por letra (y no gastar el límite de 60 listados por minuto).
 */
const ESPERA_BUSQUEDA_MS = 350;

/**
 * BL-163 (HU-027): listado de establecimientos y alta de uno nuevo, para el
 * rol PLATAFORMA (el guard está en PlataformaShell).
 *
 * BL-405: a todo el ancho (como Usuarios y el mapa de mesas, BL-339),
 * botones de 48 px, carga anunciada al lector de pantalla y paginación con
 * la página actual marcada y anunciada al cambiar.
 *
 * BL-406: búsqueda por razón social o RUT, en el servidor (el listado está
 * paginado). El buscador queda siempre en pantalla, también mientras carga,
 * para no perder el foco ni lo escrito.
 *
 * BL-407: «Completar alta» abre el mismo diálogo de alta con los datos del
 * establecimiento incompleto.
 *
 * BL-410: filtro por estado, también en el servidor. Se aplica apenas se
 * elige (sin la espera de la búsqueda) y vuelve a la primera página.
 *
 * BL-418: «Eliminar» (solo en los que no tienen pedidos) abre la
 * confirmación con el RUT; al cerrarla después de eliminar, se recarga la
 * página actual.
 */
export default function PlataformaPage() {
  const { token } = useKeycloakAuth();
  const [pagina, setPagina] = useState(1);
  // BL-406: `texto` es lo que se escribe; `busqueda`, lo que se pidió al
  // servidor (después de la espera).
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  // BL-410: undefined = todos los estados.
  const [estado, setEstado] = useState<FiltroEstado | undefined>();
  const [datos, setDatos] = useState<PaginaEstablecimientos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [altaAbierta, setAltaAbierta] = useState(false);
  // BL-407: establecimiento cuya alta se completa (null = alta nueva).
  const [aCompletar, setACompletar] =
    useState<EstablecimientoListado | null>(null);
  // BL-418: establecimiento a eliminar (null = diálogo cerrado) y cuántas
  // veces se abrió, para montar el diálogo de nuevo sin el RUT anterior.
  const [aEliminar, setAEliminar] = useState<EstablecimientoListado | null>(
    null,
  );
  const [aperturasEliminar, setAperturasEliminar] = useState(0);
  const inputBusqueda = useRef<HTMLInputElement>(null);
  // BL-406: número del último pedido. Si una respuesta vieja llega después
  // de una nueva (escribiendo rápido), se descarta.
  const ultimoPedido = useRef(0);

  // BL-406: aplica la búsqueda cuando se deja de escribir, y vuelve a la
  // primera página (la página 3 de la búsqueda anterior no tiene sentido).
  useEffect(() => {
    const nueva = texto.trim();
    if (nueva === busqueda) return;
    const espera = setTimeout(() => {
      setBusqueda(nueva);
      setPagina(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(espera);
  }, [texto, busqueda]);

  const cargar = useCallback(async () => {
    if (!token) return;
    const pedido = ++ultimoPedido.current;
    setCargando(true);
    setErrorCarga(null);
    try {
      const respuesta = await apiFetch<PaginaEstablecimientos>(
        rutaListado(pagina, busqueda, estado),
        token,
      );
      if (pedido === ultimoPedido.current) setDatos(respuesta);
    } catch (err) {
      if (pedido !== ultimoPedido.current) return;
      setErrorCarga(
        err instanceof ApiError
          ? mensajeDeError(err.status, err.message)
          : "No se pudo cargar el listado",
      );
    } finally {
      if (pedido === ultimoPedido.current) setCargando(false);
    }
  }, [token, pagina, busqueda, estado]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cambiarEstado = (nuevo: FiltroEstado | undefined) => {
    setEstado(nuevo);
    setPagina(1);
  };

  // BL-410: limpia la búsqueda y el filtro (el estado vacío puede venir de
  // cualquiera de los dos).
  const limpiarBusqueda = () => {
    setTexto("");
    setBusqueda("");
    setEstado(undefined);
    setPagina(1);
    inputBusqueda.current?.focus();
  };

  const paginas = datos ? totalPaginas(datos.total, datos.tamanoPagina) : 1;
  const criterio = describirCriterio(busqueda, estado);
  const sinCoincidencias = !!datos && datos.total === 0 && criterio !== "";
  let textoLimpiar = "Ver todos los estados";
  if (busqueda) {
    textoLimpiar = estado ? "Limpiar búsqueda y filtro" : "Limpiar búsqueda";
  }

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-headline-lg text-primary">Establecimientos</h1>
          <p className="text-body-md text-on-surface-variant">
            Restaurantes dados de alta en BistroLink y quién hizo cada alta.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setACompletar(null);
            setAltaAbierta(true);
          }}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            add_business
          </span>
          <span>Nuevo establecimiento</span>
        </button>
      </div>

      <BuscarEstablecimientos
        valor={texto}
        onChange={setTexto}
        estado={estado}
        onEstadoChange={cambiarEstado}
        inputRef={inputBusqueda}
      />

      {/* BL-405: resultado de cada carga, para el lector de pantalla. Está
          siempre en el DOM (una región aria-live que aparece junto con su
          texto no siempre se anuncia). BL-406 y BL-410: incluye lo que se
          buscó y el filtro. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {!cargando && !errorCarga && datos
          ? resumirPagina(datos, pagina, busqueda, estado)
          : ""}
      </p>

      {cargando && (
        <output className="flex justify-center py-12">
          <span
            className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
            aria-hidden="true"
          />
          <span className="sr-only">Cargando establecimientos…</span>
        </output>
      )}

      {!cargando && errorCarga && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {errorCarga}
        </div>
      )}

      {/* BL-406: estado vacío propio cuando la búsqueda no encuentra nada
          (distinto del de «todavía no hay establecimientos»). BL-410: también
          con el filtro por estado. */}
      {!cargando && !errorCarga && sinCoincidencias && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span
            className="material-symbols-outlined text-4xl text-on-surface-variant"
            aria-hidden="true"
          >
            search_off
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            Ningún establecimiento coincide con {criterio}
          </p>
          {busqueda && (
            <p className="mt-1 text-body-md text-on-surface-variant">
              Se busca por razón social o RUT. El nombre del restaurante todavía
              no se puede buscar.
            </p>
          )}
          <button
            type="button"
            onClick={limpiarBusqueda}
            className="mt-4 min-h-12 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container"
          >
            {textoLimpiar}
          </button>
        </div>
      )}

      {!cargando && !errorCarga && datos && !sinCoincidencias && (
        <>
          <EstablecimientosTable
            establecimientos={datos.items}
            onCompletarAlta={(e) => {
              setACompletar(e);
              setAltaAbierta(true);
            }}
            onEliminar={(e) => {
              setAperturasEliminar((n) => n + 1);
              setAEliminar(e);
            }}
          />

          {datos.total > 0 && (
            <nav
              aria-label="Páginas de establecimientos"
              className="flex flex-col gap-2 text-body-md text-on-surface-variant sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                {datos.total}{" "}
                {datos.total === 1 ? "establecimiento" : "establecimientos"}
              </span>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <button
                  type="button"
                  onClick={() => setPagina((p) => p - 1)}
                  disabled={pagina <= 1}
                  aria-label="Página anterior"
                  className={CLASE_BOTON_PAGINA}
                >
                  <span
                    className="material-symbols-outlined text-[20px]"
                    aria-hidden="true"
                  >
                    chevron_left
                  </span>
                  <span aria-hidden="true">Anterior</span>
                </button>
                <span aria-current="page">
                  Página {pagina} de {paginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => p + 1)}
                  disabled={pagina >= paginas}
                  aria-label="Página siguiente"
                  className={CLASE_BOTON_PAGINA}
                >
                  <span aria-hidden="true">Siguiente</span>
                  <span
                    className="material-symbols-outlined text-[20px]"
                    aria-hidden="true"
                  >
                    chevron_right
                  </span>
                </button>
              </div>
            </nav>
          )}
        </>
      )}

      {aEliminar && (
        <EliminarEstablecimientoDialog
          key={aperturasEliminar}
          open
          onClose={() => setAEliminar(null)}
          token={token}
          establecimiento={aEliminar}
          textoAlTerminar="Cerrar"
          onTerminado={() => {
            setAEliminar(null);
            // Si era el único de una página que no es la primera, vuelve
            // una atrás (la actual quedaría vacía).
            if (datos?.items.length === 1 && pagina > 1) {
              setPagina((p) => p - 1);
            } else {
              cargar();
            }
          }}
        />
      )}

      <AltaEstablecimientoDialog
        open={altaAbierta}
        onClose={() => {
          setAltaAbierta(false);
          setACompletar(null);
        }}
        token={token}
        completar={aCompletar}
        onCreado={() => {
          // El alta nueva aparece primera: volver a la página 1 y recargar.
          // BL-407: al completar un alta, el establecimiento sigue en su
          // página; se recarga la actual para que deje de figurar incompleto.
          if (aCompletar || pagina === 1) cargar();
          else setPagina(1);
        }}
      />
    </div>
  );
}
