/**
 * BL-398 (BL-392): funciones puras de la pantalla Gestión de Carta. Están
 * fuera del componente para probarlas solas y para no anidar funciones
 * dentro de los efectos (regla de Sonar).
 */

import { normalizarParaBuscar as normalizar } from "@/components/admin/usuarios/Usuarios.utils";

export interface ItemGestion {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly precio: string;
  readonly disponible: boolean;
  readonly imagenKey?: string;
  readonly imagenUrl?: string | null;
  readonly categoriaId: string;
  readonly tieneHistorial?: boolean;
  /** BL-394: fecha de archivo (ISO); null o ausente si está activo. */
  readonly archivadoEn?:
    string | null; /** BL-394: versión para el bloqueo optimista al editar. */
  readonly updatedAt?: string;
}

export interface CategoriaGestion {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion?: string | null;
  readonly activo: boolean;
  readonly orden: number;
  readonly items: readonly ItemGestion[];
  /** BL-394: fecha de archivo (ISO); null o ausente si está activa. */
  readonly archivadaEn?:
    string | null; /** BL-394: versión para el bloqueo optimista al editar. */
  readonly updatedAt?: string;
}

type Categorias = readonly CategoriaGestion[];

/** Cambia la disponibilidad de un ítem, esté en la categoría que esté. */
export function conDisponibilidad(
  categorias: Categorias,
  itemId: string,
  disponible: boolean,
): CategoriaGestion[] {
  return categorias.map((cat) => ({
    ...cat,
    items: cat.items.map((item) =>
      item.id === itemId ? { ...item, disponible } : item,
    ),
  }));
}

/** Cambia la visibilidad (`activo`) de una categoría. */
export function conVisibilidad(
  categorias: Categorias,
  categoriaId: string,
  activo: boolean,
): CategoriaGestion[] {
  return categorias.map((cat) =>
    cat.id === categoriaId ? { ...cat, activo } : cat,
  );
}

/** BL-394: saca un ítem archivado o eliminado de todas las categorías. */
export function sinItem(
  categorias: Categorias,
  itemId: string,
): CategoriaGestion[] {
  return categorias.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) => item.id !== itemId),
  }));
}

/** BL-394: saca una categoría archivada o eliminada. */
export function sinCategoria(
  categorias: Categorias,
  categoriaId: string,
): CategoriaGestion[] {
  return categorias.filter((cat) => cat.id !== categoriaId);
}

function cantidad(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Contador del encabezado: «12 ítems · 2 agotados». Los agotados solo se
 * nombran si hay alguno.
 */
export function textoContadorCarta(categorias: Categorias): string {
  const items = categorias.flatMap((cat) => cat.items);
  const agotados = items.filter((item) => !item.disponible).length;
  const total = cantidad(items.length, "ítem", "ítems");
  return agotados > 0
    ? `${total} · ${cantidad(agotados, "agotado", "agotados")}`
    : total;
}

/** Contador de una categoría: «3 ítems». */
export function textoItemsDeCategoria(categoria: CategoriaGestion): string {
  return cantidad(categoria.items.length, "ítem", "ítems");
}

// ── BL-398 (parte 2): búsqueda y filtros ────────────────────────────────────

export type FiltroEstadoCarta =
  | "TODOS"
  | "DISPONIBLES"
  | "AGOTADOS"
  | "OCULTOS"
  // BL-398 (parte 3): lo archivado se carga aparte (incluirArchivados).
  | "ARCHIVADOS";

export interface FiltrosCarta {
  readonly busqueda: string;
  readonly estado: FiltroEstadoCarta;
  /** Id de la categoría, o "TODAS". */
  readonly categoriaId: string;
}

export const FILTROS_CARTA_INICIALES: FiltrosCarta = {
  busqueda: "",
  estado: "TODOS",
  categoriaId: "TODAS",
};

export function hayFiltrosCarta(filtros: FiltrosCarta): boolean {
  return (
    filtros.busqueda.trim() !== "" ||
    filtros.estado !== FILTROS_CARTA_INICIALES.estado ||
    filtros.categoriaId !== FILTROS_CARTA_INICIALES.categoriaId
  );
}

function itemPasaElEstado(
  item: ItemGestion,
  estado: FiltroEstadoCarta,
): boolean {
  if (estado === "DISPONIBLES") return item.disponible;
  if (estado === "AGOTADOS") return !item.disponible;
  return true;
}

function categoriaPasaElEstado(
  categoria: CategoriaGestion,
  estado: FiltroEstadoCarta,
): boolean {
  // «Ocultos»: los ítems de las categorías que no se ven en la carta.
  return estado === "OCULTOS" ? !categoria.activo : true;
}

/**
 * Categorías con los ítems que cumplen los filtros. La búsqueda mira el
 * nombre y la descripción del ítem, sin distinguir mayúsculas ni tildes, y
 * también el nombre de la categoría (buscar «postres» trae todos sus
 * ítems). Sin filtros devuelve todo, incluidas las categorías vacías; con
 * filtros, solo las categorías que tienen algún ítem que coincide.
 */
export function filtrarCarta(
  categorias: Categorias,
  filtros: FiltrosCarta,
): CategoriaGestion[] {
  if (!hayFiltrosCarta(filtros)) return [...categorias];
  const termino = normalizar(filtros.busqueda);
  return categorias
    .filter(
      (cat) =>
        (filtros.categoriaId === "TODAS" || cat.id === filtros.categoriaId) &&
        categoriaPasaElEstado(cat, filtros.estado),
    )
    .map((cat) => {
      const coincideCategoria =
        termino !== "" && normalizar(cat.nombre).includes(termino);
      const items = cat.items.filter(
        (item) =>
          itemPasaElEstado(item, filtros.estado) &&
          (termino === "" ||
            coincideCategoria ||
            normalizar(`${item.nombre} ${item.descripcion ?? ""}`).includes(
              termino,
            )),
      );
      return { ...cat, items };
    })
    .filter((cat) => cat.items.length > 0);
}

/** Con filtros: «3 de 12 ítems». Lo que se anuncia al lector de pantalla. */
export function textoResultadoFiltros(
  filtradas: Categorias,
  todas: Categorias,
): string {
  const encontrados = filtradas.flatMap((cat) => cat.items).length;
  const total = todas.flatMap((cat) => cat.items).length;
  return `${encontrados} de ${cantidad(total, "ítem", "ítems")}`;
}

// ── BL-398 (parte 3): archivados ────────────────────────────────────────────

/**
 * De la carta pedida con `incluirArchivados=true`, deja solo lo archivado:
 * las categorías archivadas (con todos sus ítems) y, de las activas, los
 * ítems archivados.
 */
export function soloArchivados(categorias: Categorias): CategoriaGestion[] {
  return categorias
    .map((cat) =>
      cat.archivadaEn
        ? cat
        : { ...cat, items: cat.items.filter((item) => item.archivadoEn) },
    )
    .filter((cat) => cat.archivadaEn || cat.items.length > 0);
}

/** «3 ítems y 1 categoría archivados», o «Nada archivado». */
export function textoArchivados(categorias: Categorias): string {
  const items = categorias.flatMap((cat) => cat.items).length;
  const cats = categorias.filter((cat) => cat.archivadaEn).length;
  if (items === 0 && cats === 0) return "Nada archivado";
  const partes = [
    items > 0 ? cantidad(items, "ítem", "ítems") : null,
    cats > 0 ? cantidad(cats, "categoría", "categorías") : null,
  ].filter(Boolean);
  const plural = items + cats > 1 ? "archivados" : "archivado";
  return `${partes.join(" y ")} ${plural}`;
}

/**
 * BL-394: un ítem se puede eliminar definitivamente si no figura en ningún
 * pedido; una categoría, si no tiene ningún ítem (ni archivado). Si no, solo
 * se ofrece «Restaurar». La API lo vuelve a verificar (409).
 */
export function sePuedeEliminarItem(item: ItemGestion): boolean {
  return item.tieneHistorial === false;
}

export function sePuedeEliminarCategoria(categoria: CategoriaGestion): boolean {
  return categoria.items.length === 0;
}

const FORMATO_FECHA_ARCHIVO = new Intl.DateTimeFormat("es-UY", {
  timeZone: "America/Montevideo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** «Archivado el 31/10/2026», en hora de Uruguay. */
export function textoFechaArchivo(
  iso: string | null | undefined,
  genero: "o" | "a",
): string | null {
  if (!iso) return null;
  return `Archivad${genero} el ${FORMATO_FECHA_ARCHIVO.format(new Date(iso))}`;
}

// ── BL-398 (parte 4): formularios ───────────────────────────────────────────

/** Mismos límites que CreateCategoriaDto en el backend (BL-395). */
export const LARGO_MAXIMO_NOMBRE_CATEGORIA = 60;
export const LARGO_MAXIMO_DESCRIPCION_CATEGORIA = 200;

/** Error del nombre de una categoría, o null si es válido. */
export function errorNombreCategoria(nombre: string): string | null {
  const limpio = nombre.trim();
  if (!limpio) return "Ingresá el nombre de la categoría.";
  if (limpio.length > LARGO_MAXIMO_NOMBRE_CATEGORIA) {
    return `Tiene que tener ${LARGO_MAXIMO_NOMBRE_CATEGORIA} caracteres como máximo.`;
  }
  return null;
}

/**
 * BL-394: la API responde 409 «Otra persona modificó este dato…» cuando el
 * formulario manda una versión (`updatedAt`) vieja. Se distingue del 409 por
 * nombre repetido para ofrecer «Recargar» en lugar de corregir el nombre.
 */
export function esConflictoDeEdicion(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: number }).status;
  return status === 409 && error.message.startsWith("Otra persona modificó");
}

/**
 * BL-398: después de un cambio propio (switch de visibilidad o de
 * disponibilidad) se guarda la versión nueva que devolvió la API. Si no, el
 * formulario de edición mandaría una versión vieja y daría un conflicto
 * falso.
 */
export function conVersionCategoria(
  categorias: Categorias,
  categoriaId: string,
  updatedAt: string | undefined,
): CategoriaGestion[] {
  if (!updatedAt) return [...categorias];
  return categorias.map((cat) =>
    cat.id === categoriaId ? { ...cat, updatedAt } : cat,
  );
}

export function conVersionItem(
  categorias: Categorias,
  itemId: string,
  updatedAt: string | undefined,
): CategoriaGestion[] {
  if (!updatedAt) return [...categorias];
  return categorias.map((cat) => ({
    ...cat,
    items: cat.items.map((item) =>
      item.id === itemId ? { ...item, updatedAt } : item,
    ),
  }));
}
