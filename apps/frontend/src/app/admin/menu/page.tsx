"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { getKeycloak } from "@/lib/keycloak";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import type { Socket } from "socket.io-client";
import { getMenuSocket } from "@/lib/socket";
import Switch from "@/components/ui/Switch";
import ItemFormModal from "@/components/menu/ItemFormModal";
import ItemImagen from "@/components/menu/ItemImagen";
import {
  ArchivarDialog,
  type ArchivarObjetivo,
} from "@/components/menu/ArchivarDialog";
import { FiltrosCarta } from "@/components/menu/FiltrosCarta";
import { ArchivadosCarta } from "@/components/menu/ArchivadosCarta";
import { EliminarDefinitivoDialog } from "@/components/menu/EliminarDefinitivoDialog";
import {
  CategoriaDialog,
  type CategoriaEnDialogo,
} from "@/components/menu/CategoriaDialog";
import {
  FILTROS_CARTA_INICIALES,
  filtrarCarta,
  hayFiltrosCarta,
  textoResultadoFiltros,
  soloArchivados,
  conVersionCategoria,
  conVersionItem,
  textoArchivados,
  type FiltrosCarta as Filtros,
  conDisponibilidad,
  conVisibilidad,
  sinCategoria,
  sinItem,
  textoContadorCarta,
  textoItemsDeCategoria,
  type CategoriaGestion,
  type ItemGestion,
} from "@/components/menu/gestion-carta.utils";
import { formatearPrecio } from "@/components/pago/pago.utils";
import {
  DEMORA_AVISO_SIN_CONEXION_MS,
  esDesconexionInesperada,
} from "@/components/admin/mesas/mapa-mesas.utils";

// Botón de ícono de 48 px, igual que las acciones de Usuarios.
const CLASE_ACCION =
  "flex h-12 w-12 flex-none items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

const horaActual = () => new Date().toLocaleTimeString("es-UY");

// ============================================================================
// ESTADO DE UN ÍTEM
// ============================================================================

/**
 * BL-398: estado con ícono y texto, sin tachado (el tachado se confundía con
 * un ítem borrado). Agotado en ámbar, como en la propuesta.
 */
function EstadoItem({ disponible }: { readonly disponible: boolean }) {
  return disponible ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2.5 py-0.5 text-body-sm text-on-surface">
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        check_circle
      </span>
      Disponible
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-fixed px-2.5 py-0.5 text-body-sm text-on-tertiary-container">
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        block
      </span>
      Agotado
    </span>
  );
}

// ============================================================================
// TARJETA DE ÍTEM
// ============================================================================
interface ItemCardProps {
  readonly item: ItemGestion;
  readonly categoria: CategoriaGestion;
  readonly onEditar: (categoria: CategoriaGestion, item: ItemGestion) => void;
  readonly onCambiarDisponibilidad: (itemId: string, actual: boolean) => void;
  readonly onArchivar: (item: ItemGestion) => void;
  // BL-395: editar y archivar son solo del ADMIN; el MOZO solo ve el switch.
  readonly puedeEditar: boolean;
}

function ItemCard({
  item,
  categoria,
  onEditar,
  onCambiarDisponibilidad,
  onArchivar,
  puedeEditar,
}: ItemCardProps) {
  return (
    <li className="flex gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3">
      <div className="h-16 w-16 flex-none overflow-hidden rounded-lg border border-outline-variant bg-surface-container">
        <ItemImagen
          url={item.imagenUrl}
          alt={item.nombre}
          className="h-full w-full object-cover"
        />
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="text-body-lg font-medium text-on-surface">
          {item.nombre}
        </h3>
        {item.descripcion && (
          <p className="line-clamp-2 text-body-md text-on-surface-variant">
            {item.descripcion}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-body-md font-semibold text-on-surface">
            {formatearPrecio(item.precio)}
          </span>
          <EstadoItem disponible={item.disponible} />
        </div>
      </div>

      <div className="flex flex-none flex-col items-end justify-between gap-1">
        <Switch
          checked={item.disponible}
          onChange={() => onCambiarDisponibilidad(item.id, item.disponible)}
          label={`${item.nombre} disponible`}
        />
        {puedeEditar && (
          <div className="flex">
            <button
              type="button"
              onClick={() => onEditar(categoria, item)}
              className={`${CLASE_ACCION} hover:text-primary`}
              title="Editar ítem"
              aria-label={`Editar ${item.nombre}`}
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                edit
              </span>
            </button>
            <button
              type="button"
              onClick={() => onArchivar(item)}
              className={`${CLASE_ACCION} hover:text-primary`}
              title="Archivar ítem"
              aria-label={`Archivar ${item.nombre}`}
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                archive
              </span>
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function AdminMenuPage() {
  // BL-395: la carta la edita el ADMIN. El MOZO la ve y solo marca ítems
  // como agotados o disponibles (la API le responde 403 en todo lo demás).
  const { hasRole } = useKeycloakAuth();
  const puedeEditarCarta = hasRole("ADMIN");
  const [categorias, setCategorias] = useState<CategoriaGestion[]>([]);
  const [loading, setLoading] = useState(true);
  // BL-398: última novedad, anunciada al lector de pantalla (aria-live).
  const [ultimaNovedad, setUltimaNovedad] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCategoria, setSelectedCategoria] = useState<{
    readonly id: string;
    readonly nombre: string;
  } | null>(null);
  const [itemToEdit, setItemToEdit] = useState<ItemGestion | null>(null);

  // BL-398 (parte 4): crear o editar una categoría en CategoriaDialog.
  const [categoriaEnDialogo, setCategoriaEnDialogo] =
    useState<CategoriaEnDialogo | null>(null);
  // BL-394: archivar se confirma con un diálogo propio (no confirm()).
  const [aArchivar, setAArchivar] = useState<ArchivarObjetivo | null>(null);
  // BL-394: errores de las acciones sin diálogo (switches) y de la carga, en
  // un aviso de la página con los tokens del tema, como Usuarios.
  const [errorPagina, setErrorPagina] = useState<string | null>(null);
  // BL-398: aviso de conexión en tiempo real perdida, como el mapa de mesas
  // (BL-331). Se muestra después de DEMORA_AVISO_SIN_CONEXION_MS, para que
  // no parpadee en cortes cortos.
  const [sinConexion, setSinConexion] = useState(false);
  const [avisoSinConexion, setAvisoSinConexion] = useState(false);
  const huboConexionRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  // BL-398 (parte 2): búsqueda y filtros. Se aplican en el navegador sobre
  // la carta ya cargada, así que no hay demora ni pedidos de más.
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_CARTA_INICIALES);
  const categoriasVisibles = useMemo(
    () => filtrarCarta(categorias, filtros),
    [categorias, filtros],
  );
  const conFiltros = hayFiltrosCarta(filtros);
  // BL-398 (parte 3): «Archivados» trae aparte lo archivado
  // (incluirArchivados=true) y lo muestra con Restaurar y Eliminar.
  const verArchivados = filtros.estado === "ARCHIVADOS";
  const [archivados, setArchivados] = useState<CategoriaGestion[]>([]);
  const [cargandoArchivados, setCargandoArchivados] = useState(false);
  const archivadosVisibles = useMemo(
    () => filtrarCarta(archivados, { ...filtros, estado: "TODOS" }),
    [archivados, filtros],
  );
  const [aEliminar, setAEliminar] = useState<ArchivarObjetivo | null>(null);

  const cargarDatos = useCallback(async () => {
    try {
      const keycloak = getKeycloak();
      const restauranteId = keycloak.tokenParsed?.restaurante_id || "";
      const data = await apiFetch<CategoriaGestion[]>(
        `/admin/menu/categoria?restauranteId=${restauranteId}`,
        keycloak.token,
      );
      setCategorias(data || []);
    } catch (error: unknown) {
      setErrorPagina(
        error instanceof Error ? error.message : "No se pudo cargar la carta",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarArchivados = useCallback(async () => {
    setCargandoArchivados(true);
    try {
      const keycloak = getKeycloak();
      const restauranteId = keycloak.tokenParsed?.restaurante_id || "";
      const data = await apiFetch<CategoriaGestion[]>(
        `/admin/menu/categoria?restauranteId=${restauranteId}&incluirArchivados=true`,
        keycloak.token,
      );
      setArchivados(soloArchivados(data || []));
    } catch (error: unknown) {
      setErrorPagina(
        error instanceof Error
          ? error.message
          : "No se pudo cargar lo archivado",
      );
    } finally {
      setCargandoArchivados(false);
    }
  }, []);

  useEffect(() => {
    if (verArchivados) void cargarArchivados();
  }, [verArchivados, cargarArchivados]);

  useEffect(() => {
    void cargarDatos();
    const keycloak = getKeycloak();
    const tenantId = keycloak.tokenParsed?.tenant_id || "";
    const socket = getMenuSocket(tenantId, keycloak.token);
    socketRef.current = socket;
    huboConexionRef.current = socket.connected;

    const alActualizarItem = (data: { itemId: string; disponible: boolean }) => {
      setCategorias((prev) =>
        conDisponibilidad(prev, data.itemId, data.disponible),
      );
      setUltimaNovedad(`Carta actualizada en tiempo real a las ${horaActual()}`);
    };
    const alActualizarCategoria = (data: {
      categoriaId: string;
      activo: boolean;
    }) => {
      setCategorias((prev) =>
        conVisibilidad(prev, data.categoriaId, data.activo),
      );
      setUltimaNovedad(`Carta actualizada en tiempo real a las ${horaActual()}`);
    };
    // BL-394: un ítem o una categoría se archivó o se eliminó en otra
    // pantalla: se saca de la lista.
    const alRetirarItem = (data: { itemId: string }) =>
      setCategorias((prev) => sinItem(prev, data.itemId));
    const alRetirarCategoria = (data: { categoriaId: string }) =>
      setCategorias((prev) => sinCategoria(prev, data.categoriaId));

    // BL-398: al reconectar se vuelve a cargar la carta, porque pudieron
    // perderse cambios mientras no había conexión.
    const alConectar = () => {
      setSinConexion(false);
      if (huboConexionRef.current) void cargarDatos();
      huboConexionRef.current = true;
    };
    const alDesconectar = (motivo: string) => {
      if (esDesconexionInesperada(motivo)) setSinConexion(true);
    };
    const alFallarConexion = () => setSinConexion(true);

    socket.on("menu:item:updated", alActualizarItem);
    socket.on("menu:categoria:updated", alActualizarCategoria);
    socket.on("menu:item:retirado", alRetirarItem);
    socket.on("menu:categoria:retirada", alRetirarCategoria);
    socket.on("connect", alConectar);
    socket.on("disconnect", alDesconectar);
    socket.on("connect_error", alFallarConexion);

    return () => {
      socket.off("menu:item:updated", alActualizarItem);
      socket.off("menu:categoria:updated", alActualizarCategoria);
      socket.off("menu:item:retirado", alRetirarItem);
      socket.off("menu:categoria:retirada", alRetirarCategoria);
      socket.off("connect", alConectar);
      socket.off("disconnect", alDesconectar);
      socket.off("connect_error", alFallarConexion);
    };
  }, [cargarDatos]);

  useEffect(() => {
    if (!sinConexion) {
      setAvisoSinConexion(false);
      return;
    }
    const temporizador = setTimeout(
      () => setAvisoSinConexion(true),
      DEMORA_AVISO_SIN_CONEXION_MS,
    );
    return () => clearTimeout(temporizador);
  }, [sinConexion]);

  // Reintenta con el mismo socket, para no perder los listeners del efecto.
  const reintentarConexion = () => {
    const socket = socketRef.current;
    if (socket && !socket.connected) socket.connect();
    void cargarDatos();
  };

  const alGuardarCategoria = (nombre: string) => {
    setUltimaNovedad(`«${nombre}» guardada a las ${horaActual()}`);
    void cargarDatos();
  };

  const cambiarDisponibilidad = async (itemId: string, actual: boolean) => {
    setErrorPagina(null);
    setCategorias((prev) => conDisponibilidad(prev, itemId, !actual));
    try {
      const keycloak = getKeycloak();
      const actualizado = await apiFetch<ItemGestion>(
        `/admin/menu/item/${itemId}/disponibilidad`,
        keycloak.token,
        {
          method: "PATCH",
          body: JSON.stringify({ disponible: !actual }),
        },
      );
      setCategorias((prev) =>
        conVersionItem(prev, itemId, actualizado?.updatedAt),
      );
    } catch (error: unknown) {
      setCategorias((prev) => conDisponibilidad(prev, itemId, actual));
      setErrorPagina(
        error instanceof Error ? error.message : "No se pudo actualizar el ítem",
      );
    }
  };

  // BL-394: «Eliminar» pasa a ser «Archivar» (baja lógica que conserva el
  // historial). Se confirma en ArchivarDialog; si la API responde 409, el
  // diálogo muestra el motivo. La eliminación definitiva y «Restaurar»
  // llegan con el filtro «Archivados» (BL-398, parte 3).
  const archivar = async ({ tipo, id }: ArchivarObjetivo) => {
    const keycloak = getKeycloak();
    const ruta =
      tipo === "item"
        ? `/admin/menu/item/${id}/archivar`
        : `/admin/menu/categoria/${id}/archivar`;
    await apiFetch(ruta, keycloak.token, { method: "POST" });
    if (tipo === "item") {
      setCategorias((prev) => sinItem(prev, id));
      setUltimaNovedad(`Ítem archivado a las ${horaActual()}`);
    } else {
      setCategorias((prev) => sinCategoria(prev, id));
      setUltimaNovedad(`Categoría archivada a las ${horaActual()}`);
    }
  };

  // BL-398 (parte 3): restaurar vuelve a dejarlo en la carta. Un 409 (nombre
  // ya usado, categoría archivada) se muestra en el aviso de la página.
  const restaurar = async ({ tipo, id, nombre }: ArchivarObjetivo) => {
    setErrorPagina(null);
    try {
      const keycloak = getKeycloak();
      const ruta =
        tipo === "item"
          ? `/admin/menu/item/${id}/restaurar`
          : `/admin/menu/categoria/${id}/restaurar`;
      await apiFetch(ruta, keycloak.token, { method: "POST" });
      setUltimaNovedad(`«${nombre}» restaurado a las ${horaActual()}`);
      await Promise.all([cargarArchivados(), cargarDatos()]);
    } catch (error: unknown) {
      setErrorPagina(
        error instanceof Error ? error.message : `No se pudo restaurar «${nombre}»`,
      );
    }
  };

  // BL-398 (parte 3): eliminar definitivamente (solo sin historial). Se
  // confirma en EliminarDefinitivoDialog, que muestra un 409 si lo hay.
  const eliminarDefinitivo = async ({ tipo, id, nombre }: ArchivarObjetivo) => {
    const keycloak = getKeycloak();
    const ruta =
      tipo === "item" ? `/admin/menu/item/${id}` : `/admin/menu/categoria/${id}`;
    await apiFetch(ruta, keycloak.token, { method: "DELETE" });
    setUltimaNovedad(`«${nombre}» eliminado a las ${horaActual()}`);
    await cargarArchivados();
  };

  const cambiarVisibilidad = async (categoriaId: string, actual: boolean) => {
    setErrorPagina(null);
    setCategorias((prev) => conVisibilidad(prev, categoriaId, !actual));
    try {
      const keycloak = getKeycloak();
      const actualizada = await apiFetch<CategoriaGestion>(
        `/admin/menu/categoria/${categoriaId}`,
        keycloak.token,
        {
          method: "PATCH",
          body: JSON.stringify({ activo: !actual }),
        },
      );
      setCategorias((prev) =>
        conVersionCategoria(prev, categoriaId, actualizada?.updatedAt),
      );
    } catch (error: unknown) {
      setCategorias((prev) => conVisibilidad(prev, categoriaId, actual));
      setErrorPagina(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la categoría",
      );
    }
  };

  // Contador del encabezado según lo que se está viendo.
  const textoDelContador = () => {
    if (verArchivados) return textoArchivados(archivadosVisibles);
    if (conFiltros) return textoResultadoFiltros(categoriasVisibles, categorias);
    return textoContadorCarta(categorias);
  };

  const abrirNuevoItem = (categoria: CategoriaGestion) => {
    setSelectedCategoria({ id: categoria.id, nombre: categoria.nombre });
    setItemToEdit(null);
    setModalOpen(true);
  };

  const abrirEditarItem = (categoria: CategoriaGestion, item: ItemGestion) => {
    setSelectedCategoria({ id: categoria.id, nombre: categoria.nombre });
    setItemToEdit(item);
    setModalOpen(true);
  };

  return (
    // BL-398: a todo el ancho del área de contenido, como Usuarios y el mapa
    // de mesas (BL-339, BL-364).
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-headline-lg text-primary">Gestión de Carta</h1>
          <p className="text-body-md text-on-surface-variant">
            {puedeEditarCarta
              ? "Categorías, ítems y disponibilidad de la carta, en tiempo real."
              : "Marcá los ítems agotados o disponibles, en tiempo real."}
          </p>
        </div>
        {puedeEditarCarta && (
          <button
            type="button"
            onClick={() => setCategoriaEnDialogo({ modo: "crear" })}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-md font-medium text-on-primary hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              add
            </span>
            <span>Nueva categoría</span>
          </button>
        )}
      </div>

      {avisoSinConexion && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-xl border border-error bg-error-container px-4 py-3 text-body-md text-on-error-container md:flex-row md:items-center md:justify-between"
        >
          <span className="flex items-start gap-2">
            <span className="material-symbols-outlined" aria-hidden="true">
              wifi_off
            </span>
            <span>
              Sin conexión en tiempo real. La carta puede no estar actualizada.
              Reconectando…
            </span>
          </span>
          <button
            type="button"
            onClick={reintentarConexion}
            className="min-h-12 rounded-lg px-4 font-medium hover:opacity-80"
          >
            Reintentar
          </button>
        </div>
      )}

      {errorPagina && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          <span>{errorPagina}</span>
          <button
            type="button"
            onClick={() => setErrorPagina(null)}
            aria-label="Cerrar aviso"
            className="-my-2 -mr-2 flex h-12 w-12 flex-none items-center justify-center rounded-full hover:opacity-80"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <span className="sr-only">Cargando la carta…</span>
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && categorias.length > 0 && (
        // BL-398: barra fija arriba al desplazarse, para encontrar y marcar
        // un faltante en pleno servicio sin recorrer toda la carta.
        <div className="sticky top-0 z-10 -mx-4 border-b border-outline-variant bg-surface px-4 py-3 md:-mx-6 md:px-6">
          <FiltrosCarta
            filtros={filtros}
            onChange={setFiltros}
            categorias={verArchivados ? archivados : categorias}
            esAdmin={puedeEditarCarta}
          />
        </div>
      )}

      {!loading && (
        // Contador y última novedad: se anuncian al lector de pantalla
        // cuando cambian, sin mover el foco (como en Usuarios, BL-363).
        <p
          className="text-body-md text-on-surface-variant"
          aria-live="polite"
          aria-atomic="true"
        >
          {textoDelContador()}
          {ultimaNovedad && ` · ${ultimaNovedad}`}
        </p>
      )}

      {!loading && categorias.length === 0 && (
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
            restaurant_menu
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            Todavía no hay categorías en la carta
          </p>
          {puedeEditarCarta && (
            <button
              type="button"
              onClick={() => setCategoriaEnDialogo({ modo: "crear" })}
              className="mt-4 min-h-12 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container"
            >
              Crear la primera categoría
            </button>
          )}
        </div>
      )}

      {!loading && verArchivados && cargandoArchivados && (
        <div className="flex justify-center py-12">
          <span className="sr-only">Cargando lo archivado…</span>
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {!loading && verArchivados && !cargandoArchivados && (
        <ArchivadosCarta
          categorias={archivadosVisibles}
          onRestaurar={restaurar}
          onEliminar={setAEliminar}
        />
      )}

      {!loading && !verArchivados && conFiltros && categoriasVisibles.length === 0 && (
        // Estado vacío propio cuando los filtros no dejan nada (como Usuarios).
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-12 text-center">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant" aria-hidden="true">
            search_off
          </span>
          <p className="mt-2 text-body-lg text-on-surface">
            No hay ítems con esos filtros
          </p>
          <button
            type="button"
            onClick={() => setFiltros(FILTROS_CARTA_INICIALES)}
            className="mt-4 min-h-12 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container"
          >
            Quitar los filtros
          </button>
        </div>
      )}

      {!loading &&
        !verArchivados &&
        categoriasVisibles.map((cat) => (
          <section
            key={cat.id}
            aria-labelledby={`categoria-${cat.id}`}
            className={`overflow-hidden rounded-xl border border-outline-variant ${
              cat.activo ? "bg-surface-container-lowest" : "bg-surface-container"
            }`}
          >
            <div className="flex flex-col gap-2 border-b border-outline-variant bg-surface-container-low px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={`categoria-${cat.id}`} className="text-headline-sm text-on-surface">
                  {cat.nombre}
                </h2>
                {!cat.activo && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-highest px-2.5 py-0.5 text-body-sm text-on-surface-variant">
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                      visibility_off
                    </span>
                    Oculta
                  </span>
                )}
                <span className="text-body-md text-on-surface-variant">
                  {textoItemsDeCategoria(cat)}
                </span>
                {/* BL-393: subtítulo opcional de la categoría. */}
                {cat.descripcion && (
                  <p className="w-full text-body-md text-on-surface-variant">
                    {cat.descripcion}
                  </p>
                )}
              </div>
              {puedeEditarCarta && (
                <div className="flex items-center gap-2">
                  <span className="text-body-md text-on-surface-variant">Visible</span>
                  <Switch
                    checked={cat.activo}
                    onChange={() => cambiarVisibilidad(cat.id, cat.activo)}
                    label={`Categoría ${cat.nombre} visible en la carta`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setCategoriaEnDialogo({ modo: "editar", categoria: cat })
                    }
                    className={`${CLASE_ACCION} hover:text-primary`}
                    title="Editar categoría"
                    aria-label={`Editar categoría ${cat.nombre}`}
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      edit
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAArchivar({
                        tipo: "categoria",
                        id: cat.id,
                        nombre: cat.nombre,
                      })
                    }
                    className={`${CLASE_ACCION} hover:text-primary`}
                    title="Archivar categoría"
                    aria-label={`Archivar categoría ${cat.nombre}`}
                  >
                    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                      archive
                    </span>
                  </button>
                </div>
              )}
            </div>

            {cat.items.length === 0 ? (
              <p className="px-4 py-8 text-center text-body-md text-on-surface-variant">
                No hay ítems en esta categoría.
              </p>
            ) : (
              // BL-398: en PC los ítems van en 2 o 3 columnas para aprovechar
              // el ancho sin que cada tarjeta quede demasiado estirada.
              <ul className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
                {cat.items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    categoria={cat}
                    onEditar={abrirEditarItem}
                    onCambiarDisponibilidad={cambiarDisponibilidad}
                    onArchivar={(i) =>
                      setAArchivar({ tipo: "item", id: i.id, nombre: i.nombre })
                    }
                    puedeEditar={puedeEditarCarta}
                  />
                ))}
              </ul>
            )}

            {puedeEditarCarta && (
              <div className="border-t border-outline-variant px-4 py-2">
                <button
                  type="button"
                  onClick={() => abrirNuevoItem(cat)}
                  className="flex min-h-12 items-center gap-1 rounded-lg px-2 text-body-md font-medium text-primary hover:bg-surface-container"
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    add
                  </span>
                  Agregar ítem
                </button>
              </div>
            )}
          </section>
        ))}

      {modalOpen && selectedCategoria && (
        <ItemFormModal
          categoriaId={selectedCategoria.id}
          categoriaNombre={selectedCategoria.nombre}
          onClose={() => setModalOpen(false)}
          onSuccess={cargarDatos}
          itemToEdit={itemToEdit || undefined}
        />
      )}

      <ArchivarDialog
        objetivo={aArchivar}
        onClose={() => setAArchivar(null)}
        onConfirmar={archivar}
      />

      <EliminarDefinitivoDialog
        objetivo={aEliminar}
        onClose={() => setAEliminar(null)}
        onConfirmar={eliminarDefinitivo}
      />

      <CategoriaDialog
        objetivo={categoriaEnDialogo}
        onClose={() => setCategoriaEnDialogo(null)}
        onGuardada={alGuardarCategoria}
        onRecargar={() => void cargarDatos()}
      />
    </div>
  );
}
