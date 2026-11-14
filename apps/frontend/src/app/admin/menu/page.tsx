"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";
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
import { MenuAcciones, type AccionMenu } from "@/components/menu/MenuAcciones";
import {
  IndiceCategorias,
  MINIMO_CATEGORIAS_INDICE,
  idSeccionCategoria,
  idTituloCategoria,
} from "@/components/menu/IndiceCategorias";
import { AvisoDeshacer } from "@/components/menu/AvisoDeshacer";
import { ListaOrdenable, Ordenable } from "@/components/menu/ListaOrdenable";
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
  conDestacado,
  conDisponibilidad,
  etiquetaEstrella,
  conVisibilidad,
  sinCategoria,
  sinItem,
  textoContadorCarta,
  textoItemsDeCategoria,
  conCategoriaMovida,
  conItemMovido,
  conCategoriaEn,
  conItemEn,
  textoPosicion,
  type Desplazamiento,
  type CategoriaGestion,
  type ItemGestion,
} from "@/components/menu/gestion-carta.utils";
import { formatearPrecio } from "@/components/pago/pago.utils";
import {
  DEMORA_AVISO_SIN_CONEXION_MS,
  esDesconexionInesperada,
} from "@/components/admin/mesas/mapa-mesas.utils";
import {
  IconoEstrella,
  TEXTO_SUGERENCIA_DEL_LOCAL,
} from "@/components/menu-digital/InsigniaPlato";

const horaActual = () => new Date().toLocaleTimeString("es-UY");

/** BL-398 (parte 5): «Ítem «Flan» archivado» / «Categoría «Postres» archivada». */
const textoAvisoDeshacer = (objetivo: ArchivarObjetivo | null) => {
  if (!objetivo) return null;
  return objetivo.tipo === "item"
    ? `Ítem «${objetivo.nombre}» archivado`
    : `Categoría «${objetivo.nombre}» archivada`;
};

/**
 * BL-399: «Subir» y «Bajar» en el menú «⋯», solo cuando hay adónde moverlo.
 */
function accionesDeOrden(
  puedeSubir: boolean,
  puedeBajar: boolean,
  onMover: (desplazamiento: Desplazamiento) => void,
): AccionMenu[] {
  const acciones: AccionMenu[] = [];
  if (puedeSubir) {
    acciones.push({
      id: "subir",
      texto: "Subir",
      icono: "arrow_upward",
      onSelect: () => onMover(-1),
    });
  }
  if (puedeBajar) {
    acciones.push({
      id: "bajar",
      texto: "Bajar",
      icono: "arrow_downward",
      onSelect: () => onMover(1),
    });
  }
  return acciones;
}

/**
 * BL-399: al reordenar, React mueve el elemento en la página y el navegador
 * puede perder el foco. Se lo devuelve al «⋯» de lo que se movió, para
 * poder seguir subiendo o bajando con el teclado.
 */
function enfocarMenuDe(selector: string) {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLButtonElement>(`${selector} button[aria-haspopup="menu"]`)
      ?.focus();
  });
}

// ============================================================================
// AGOTADO
// ============================================================================

/**
 * BL-398 / BL-400: solo se marca la excepción. Un ítem disponible no lleva
 * badge (el switch ya lo dice); uno agotado, sí, en ámbar y con ícono, sin
 * tachado (el tachado se confundía con un ítem borrado).
 */
function BadgeAgotado() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-fixed px-2.5 py-0.5 text-body-sm text-on-tertiary-container">
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        block
      </span>
      <span>Agotado</span>
    </span>
  );
}

/**
 * HU-044 (BL-537): rótulo de un plato marcado como «Sugerencia del local».
 * Ícono y texto, como «Agotado»: el estado no depende del relleno de la
 * estrella. Es igual a la insignia que ve el comensal (fondo #755b00 y texto
 * blanco, 6.46:1), y así no se confunde con el ámbar claro de «Agotado».
 */
function BadgeSugerencia() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#755b00] px-2.5 py-0.5 text-body-sm text-white">
      <IconoEstrella rellena tamano={14} />
      <span>{TEXTO_SUGERENCIA_DEL_LOCAL}</span>
    </span>
  );
}

/**
 * HU-044 (BL-537): estrella para marcar o desmarcar la sugerencia con un
 * toque (solo ADMIN). 44 × 44 px, nombre fijo y `aria-pressed`.
 */
function BotonEstrella({
  item,
  onCambiar,
}: {
  readonly item: ItemGestion;
  readonly onCambiar: (itemId: string, actual: boolean) => void;
}) {
  const marcado = item.destacado === true;
  return (
    <button
      type="button"
      aria-pressed={marcado}
      aria-label={etiquetaEstrella(item)}
      title={marcado ? "Quitar de las sugerencias" : "Sugerir este plato"}
      onClick={() => onCambiar(item.id, marcado)}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
        marcado ? "text-[#755b00]" : "text-on-surface-variant"
      }`}
    >
      <IconoEstrella rellena={marcado} tamano={22} />
    </button>
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
  // HU-044 (BL-537): «Sugerencia del local» (solo ADMIN).
  readonly onCambiarDestacado: (itemId: string, actual: boolean) => void;
  readonly onArchivar: (item: ItemGestion) => void;
  // BL-399: mover un lugar dentro de la categoría.
  readonly onMover: (item: ItemGestion, desplazamiento: Desplazamiento) => void;
  readonly puedeSubir: boolean;
  readonly puedeBajar: boolean;
  // BL-399 (parte 2): muestra la manija para arrastrar.
  readonly puedeArrastrar: boolean;
  // BL-395: editar y archivar son solo del ADMIN; el MOZO solo ve el switch.
  readonly puedeEditar: boolean;
}

/**
 * BL-400: tarjeta simplificada. Nombre y precio en la misma línea, la
 * descripción debajo y el badge solo si está agotado. A la derecha, el
 * switch de disponibilidad y el menú «⋯» (Editar, Subir, Bajar, Archivar).
 * Para el ADMIN, el nombre abre el formulario de edición. A la izquierda, la
 * manija «⠿» para arrastrarlo (BL-399).
 */
function ItemCard({
  item,
  categoria,
  onEditar,
  onCambiarDisponibilidad,
  onCambiarDestacado,
  onArchivar,
  onMover,
  puedeSubir,
  puedeBajar,
  puedeArrastrar,
  puedeEditar,
}: ItemCardProps) {
  return (
    <Ordenable
      id={item.id}
      etiqueta={`Mover ${item.nombre}`}
      deshabilitado={!puedeArrastrar}
    >
      {({ ref, style, arrastrando, manija }) => (
        <li
          ref={ref}
          style={style}
          data-acciones-item={item.id}
          className={`flex items-start gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-3 ${
            arrastrando ? "shadow-lg ring-2 ring-primary" : ""
          }`}
        >
          {manija && <div className="-my-1 -ml-2">{manija}</div>}
          <div className="h-14 w-14 flex-none overflow-hidden rounded-lg border border-outline-variant bg-surface-container">
            <ItemImagen
              url={item.imagenUrl}
              alt={item.nombre}
              className="h-full w-full object-cover"
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h3 className="text-body-lg font-medium text-on-surface">
                {puedeEditar ? (
                  <button
                    type="button"
                    onClick={() => onEditar(categoria, item)}
                    className="rounded text-left hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="sr-only">Editar </span>
                    {item.nombre}
                  </button>
                ) : (
                  item.nombre
                )}
              </h3>
              <span className="text-body-md font-semibold text-on-surface">
                {formatearPrecio(item.precio)}
              </span>
            </div>
            {item.descripcion && (
              <p className="line-clamp-2 text-body-md text-on-surface-variant">
                {item.descripcion}
              </p>
            )}
            {(!item.disponible || item.destacado) && (
              <div className="mt-1 flex flex-wrap gap-2">
                {!item.disponible && <BadgeAgotado />}
                {item.destacado && <BadgeSugerencia />}
              </div>
            )}
          </div>

          {/* HU-044 (BL-537): en el celular la estrella va debajo del switch,
              para no achicar el nombre y la descripción; desde sm, en la
              misma fila. */}
          <div className="flex flex-none flex-col items-start gap-1 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1">
              <Switch
                checked={item.disponible}
                onChange={() => onCambiarDisponibilidad(item.id, item.disponible)}
                label={`${item.nombre} disponible`}
              />
              {puedeEditar && (
                <MenuAcciones
                  etiqueta={`Acciones de ${item.nombre}`}
                  acciones={[
                    {
                      id: "editar",
                      texto: "Editar",
                      icono: "edit",
                      onSelect: () => onEditar(categoria, item),
                    },
                    ...accionesDeOrden(puedeSubir, puedeBajar, (d) =>
                      onMover(item, d),
                    ),
                    {
                      id: "archivar",
                      texto: "Archivar",
                      icono: "archive",
                      onSelect: () => onArchivar(item),
                    },
                  ]}
                />
              )}
            </div>
            {puedeEditar && (
              <div className="sm:order-first">
                <BotonEstrella item={item} onCambiar={onCambiarDestacado} />
              </div>
            )}
          </div>
        </li>
      )}
    </Ordenable>
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
  // BL-400: el índice solo ayuda con una carta larga.
  const mostrarIndice =
    !verArchivados && categoriasVisibles.length >= MINIMO_CATEGORIAS_INDICE;
  const [archivados, setArchivados] = useState<CategoriaGestion[]>([]);
  const [cargandoArchivados, setCargandoArchivados] = useState(false);
  const archivadosVisibles = useMemo(
    () => filtrarCarta(archivados, { ...filtros, estado: "TODOS" }),
    [archivados, filtros],
  );
  const [aEliminar, setAEliminar] = useState<ArchivarObjetivo | null>(null);
  // BL-398 (parte 5): lo último que se archivó, para el aviso «Deshacer».
  const [ultimoArchivo, setUltimoArchivo] = useState<ArchivarObjetivo | null>(
    null,
  );
  const vencerAvisoDeshacer = useCallback(() => setUltimoArchivo(null), []);
  // BL-399: con filtros la lista está incompleta y «subir un lugar» no sería
  // claro, así que solo se reordena viendo la carta entera.
  const puedeOrdenar = puedeEditarCarta && !conFiltros;
  // Mientras se guarda un orden no se acepta otro, para que no se crucen.
  const guardandoOrdenRef = useRef(false);

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
    // HU-044 (BL-537): otro ADMIN marcó o desmarcó una sugerencia. El evento
    // trae el ítem guardado; solo se toma `destacado` (el resto de la
    // edición llega al recargar, como hasta ahora).
    const alActualizarDatosItem = (payload: {
      itemId: string;
      data: { destacado?: unknown };
    }) => {
      const destacado = payload.data?.destacado;
      if (typeof destacado !== "boolean") return;
      setCategorias((prev) => conDestacado(prev, payload.itemId, destacado));
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
    // BL-399: alguien cambió el orden: se vuelve a cargar la carta.
    const alReordenarCarta = () => {
      void cargarDatos();
    };

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
    socket.on("menu:item:data:updated", alActualizarDatosItem);
    socket.on("menu:categoria:updated", alActualizarCategoria);
    socket.on("menu:item:retirado", alRetirarItem);
    socket.on("menu:categoria:retirada", alRetirarCategoria);
    socket.on("menu:carta:reordenada", alReordenarCarta);
    socket.on("connect", alConectar);
    socket.on("disconnect", alDesconectar);
    socket.on("connect_error", alFallarConexion);

    return () => {
      socket.off("menu:item:updated", alActualizarItem);
      socket.off("menu:item:data:updated", alActualizarDatosItem);
      socket.off("menu:categoria:updated", alActualizarCategoria);
      socket.off("menu:item:retirado", alRetirarItem);
      socket.off("menu:categoria:retirada", alRetirarCategoria);
      socket.off("menu:carta:reordenada", alReordenarCarta);
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

  // HU-044 (BL-537): marcar o desmarcar la «Sugerencia del local». Se ve al
  // instante y, si la API falla, vuelve a como estaba.
  const cambiarDestacado = async (itemId: string, actual: boolean) => {
    setErrorPagina(null);
    setCategorias((prev) => conDestacado(prev, itemId, !actual));
    try {
      const keycloak = getKeycloak();
      const actualizado = await apiFetch<ItemGestion>(
        `/admin/menu/item/${itemId}`,
        keycloak.token,
        {
          method: "PATCH",
          body: JSON.stringify({ destacado: !actual }),
        },
      );
      setCategorias((prev) =>
        conVersionItem(prev, itemId, actualizado?.updatedAt),
      );
    } catch (error: unknown) {
      setCategorias((prev) => conDestacado(prev, itemId, actual));
      setErrorPagina(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la sugerencia",
      );
    }
  };

  // BL-394: «Eliminar» pasa a ser «Archivar» (baja lógica que conserva el
  // historial). Se confirma en ArchivarDialog; si la API responde 409, el
  // diálogo muestra el motivo. La eliminación definitiva y «Restaurar»
  // llegan con el filtro «Archivados» (BL-398, parte 3).
  const archivar = async (objetivo: ArchivarObjetivo) => {
    const { tipo, id } = objetivo;
    const keycloak = getKeycloak();
    const ruta =
      tipo === "item"
        ? `/admin/menu/item/${id}/archivar`
        : `/admin/menu/categoria/${id}/archivar`;
    await apiFetch(ruta, keycloak.token, { method: "POST" });
    setUltimoArchivo(objetivo);
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

  // BL-399: el cambio se ve enseguida y se guarda la lista completa de ids.
  // Si falla, vuelve como estaba; si es 409 (la carta cambió en otra
  // pantalla), además se trae la carta actual.
  const guardarOrden = async (
    anterior: CategoriaGestion[],
    nuevas: CategoriaGestion[],
    ruta: string,
    ids: string[],
    novedad: string,
  ) => {
    guardandoOrdenRef.current = true;
    setErrorPagina(null);
    setCategorias(nuevas);
    setUltimaNovedad(novedad);
    try {
      const keycloak = getKeycloak();
      await apiFetch(ruta, keycloak.token, {
        method: "PUT",
        body: JSON.stringify({ ids }),
      });
    } catch (error: unknown) {
      setCategorias(anterior);
      setErrorPagina(
        error instanceof Error ? error.message : "No se pudo guardar el orden",
      );
      if (error instanceof ApiError && error.status === 409) void cargarDatos();
    } finally {
      guardandoOrdenRef.current = false;
    }
  };

  // BL-399: Subir / Bajar y arrastrar guardan igual: la lista completa.
  const guardarOrdenCategorias = (
    nuevas: CategoriaGestion[],
    categoria: CategoriaGestion,
  ) => {
    const posicion = nuevas.findIndex((c) => c.id === categoria.id) + 1;
    void guardarOrden(
      categorias,
      nuevas,
      "/admin/menu/categorias/orden",
      nuevas.map((c) => c.id),
      textoPosicion(categoria.nombre, posicion, nuevas.length),
    );
  };

  const guardarOrdenItems = (
    nuevas: CategoriaGestion[],
    categoria: CategoriaGestion,
    item: ItemGestion,
  ) => {
    const items = nuevas.find((c) => c.id === categoria.id)?.items ?? [];
    const posicion = items.findIndex((i) => i.id === item.id) + 1;
    void guardarOrden(
      categorias,
      nuevas,
      `/admin/menu/categoria/${categoria.id}/orden`,
      items.map((i) => i.id),
      textoPosicion(item.nombre, posicion, items.length),
    );
  };

  const moverCategoria = (
    categoria: CategoriaGestion,
    desplazamiento: Desplazamiento,
  ) => {
    if (guardandoOrdenRef.current) return;
    const nuevas = conCategoriaMovida(categorias, categoria.id, desplazamiento);
    if (!nuevas) return;
    guardarOrdenCategorias(nuevas, categoria);
    enfocarMenuDe(`[data-acciones-categoria="${categoria.id}"]`);
  };

  const moverItem = (
    categoria: CategoriaGestion,
    item: ItemGestion,
    desplazamiento: Desplazamiento,
  ) => {
    if (guardandoOrdenRef.current) return;
    const nuevas = conItemMovido(categorias, categoria.id, item.id, desplazamiento);
    if (!nuevas) return;
    guardarOrdenItems(nuevas, categoria, item);
    enfocarMenuDe(`[data-acciones-item="${item.id}"]`);
  };

  // BL-399 (parte 2): se soltó una categoría o un ítem en el lugar de otro.
  // Con el teclado, dnd-kit devuelve el foco a la manija.
  const soltarCategoria = (categoriaId: string, destinoId: string) => {
    if (guardandoOrdenRef.current) return;
    const categoria = categorias.find((c) => c.id === categoriaId);
    const nuevas = conCategoriaEn(categorias, categoriaId, destinoId);
    if (!categoria || !nuevas) return;
    guardarOrdenCategorias(nuevas, categoria);
  };

  const soltarItem = (
    categoria: CategoriaGestion,
    itemId: string,
    destinoId: string,
  ) => {
    if (guardandoOrdenRef.current) return;
    const item = categoria.items.find((i) => i.id === itemId);
    const nuevas = conItemEn(categorias, categoria.id, itemId, destinoId);
    if (!item || !nuevas) return;
    guardarOrdenItems(nuevas, categoria, item);
  };

  const nombreCategoria = (id: string) =>
    categorias.find((c) => c.id === id)?.nombre ?? "";

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
        // <output> en lugar de role="status" (Sonar): se anuncia igual al
        // lector de pantalla.
        <output
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
        </output>
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
          {/* BL-400: en el celular y la tablet, chips para saltar a una
              categoría; en PC va la columna de la izquierda. */}
          {mostrarIndice && (
            <div className="mt-3 xl:hidden">
              <IndiceCategorias categorias={categoriasVisibles} variante="chips" />
            </div>
          )}
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

      {!loading && puedeEditarCarta && conFiltros && !verArchivados && (
        // BL-399: con filtros no aparecen la manija ni Subir / Bajar.
        <p className="text-body-sm text-on-surface-variant">
          Para cambiar el orden, quitá los filtros.
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

      {!loading && !verArchivados && categoriasVisibles.length > 0 && (
        // BL-400: en PC, índice de categorías fijo a la izquierda y la carta
        // a la derecha.
        <div
          className={
            mostrarIndice
              ? "xl:grid xl:grid-cols-[14rem_minmax(0,1fr)] xl:items-start xl:gap-6"
              : undefined
          }
        >
          {mostrarIndice && (
            <div className="hidden xl:sticky xl:top-28 xl:block">
              <IndiceCategorias categorias={categoriasVisibles} variante="lista" />
            </div>
          )}
          <ListaOrdenable
            ids={categoriasVisibles.map((c) => c.id)}
            nombreDe={nombreCategoria}
            disposicion="lista"
            onSoltar={soltarCategoria}
          >
            <div className="space-y-6">
              {categoriasVisibles.map((cat, indiceCategoria) => (
                <Ordenable
                  key={cat.id}
                  id={cat.id}
                  etiqueta={`Mover la categoría ${cat.nombre}`}
                  deshabilitado={!puedeOrdenar}
                >
                  {({ ref, style, arrastrando, manija }) => (
                    <section
                      ref={ref}
                      style={style}
                      id={idSeccionCategoria(cat.id)}
                      aria-labelledby={idTituloCategoria(cat.id)}
                      // BL-400: margen para que, al saltar desde el índice, el título
                      // no quede tapado por la barra fija.
                      className={`scroll-mt-64 overflow-hidden rounded-xl border border-outline-variant md:scroll-mt-44 xl:scroll-mt-28 ${
                        cat.activo ? "bg-surface-container-lowest" : "bg-surface-container"
                      } ${arrastrando ? "shadow-lg ring-2 ring-primary" : ""}`}
                    >
                      <div className="flex flex-col gap-2 border-b border-outline-variant bg-surface-container-low px-4 py-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          {manija && <div className="-my-2 -ml-2">{manija}</div>}
                          <h2
                            id={idTituloCategoria(cat.id)}
                            tabIndex={-1}
                            className="text-headline-sm text-on-surface focus:outline-none"
                          >
                            {cat.nombre}
                          </h2>
                          {!cat.activo && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-highest px-2.5 py-0.5 text-body-sm text-on-surface-variant">
                              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                visibility_off
                              </span>
                              <span>Oculta</span>
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
                          <div
                            data-acciones-categoria={cat.id}
                            className="flex items-center gap-2"
                          >
                            <span className="text-body-md text-on-surface-variant">Visible</span>
                            <Switch
                              checked={cat.activo}
                              onChange={() => cambiarVisibilidad(cat.id, cat.activo)}
                              label={`Categoría ${cat.nombre} visible en la carta`}
                            />
                            <MenuAcciones
                              etiqueta={`Acciones de la categoría ${cat.nombre}`}
                              acciones={[
                                {
                                  id: "editar",
                                  texto: "Editar",
                                  icono: "edit",
                                  onSelect: () =>
                                    setCategoriaEnDialogo({
                                      modo: "editar",
                                      categoria: cat,
                                    }),
                                },
                                ...accionesDeOrden(
                                  puedeOrdenar && indiceCategoria > 0,
                                  puedeOrdenar &&
                                    indiceCategoria < categoriasVisibles.length - 1,
                                  (d) => moverCategoria(cat, d),
                                ),
                                {
                                  id: "archivar",
                                  texto: "Archivar",
                                  icono: "archive",
                                  onSelect: () =>
                                    setAArchivar({
                                      tipo: "categoria",
                                      id: cat.id,
                                      nombre: cat.nombre,
                                    }),
                                },
                              ]}
                            />
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
                        <ListaOrdenable
                          ids={cat.items.map((i) => i.id)}
                          nombreDe={(id) =>
                            cat.items.find((i) => i.id === id)?.nombre ?? ""
                          }
                          disposicion="grilla"
                          onSoltar={(id, destinoId) => soltarItem(cat, id, destinoId)}
                        >
                          <ul className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
                            {cat.items.map((item, indiceItem) => (
                              <ItemCard
                                key={item.id}
                                item={item}
                                categoria={cat}
                                onEditar={abrirEditarItem}
                                onCambiarDisponibilidad={cambiarDisponibilidad}
                                onCambiarDestacado={cambiarDestacado}
                                onArchivar={(i) =>
                                  setAArchivar({ tipo: "item", id: i.id, nombre: i.nombre })
                                }
                                onMover={(i, d) => moverItem(cat, i, d)}
                                puedeSubir={puedeOrdenar && indiceItem > 0}
                                puedeBajar={
                                  puedeOrdenar && indiceItem < cat.items.length - 1
                                }
                                puedeArrastrar={puedeOrdenar}
                                puedeEditar={puedeEditarCarta}
                              />
                            ))}
                          </ul>
                        </ListaOrdenable>
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
                            <span>Agregar ítem</span>
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                </Ordenable>
              ))}
            </div>
          </ListaOrdenable>
        </div>
      )}

      {modalOpen && selectedCategoria && (
        <ItemFormModal
          categoriaId={selectedCategoria.id}
          categoriaNombre={selectedCategoria.nombre}
          onClose={() => setModalOpen(false)}
          onSuccess={cargarDatos}
          itemToEdit={itemToEdit || undefined}
          onRecargar={() => void cargarDatos()}
        />
      )}

      <ArchivarDialog
        objetivo={aArchivar}
        onClose={() => setAArchivar(null)}
        onConfirmar={archivar}
      />

      <AvisoDeshacer
        texto={textoAvisoDeshacer(ultimoArchivo)}
        onDeshacer={() => {
          const objetivo = ultimoArchivo;
          setUltimoArchivo(null);
          if (objetivo) void restaurar(objetivo);
        }}
        onVencer={vencerAvisoDeshacer}
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
