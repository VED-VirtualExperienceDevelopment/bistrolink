'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { getKeycloak } from '@/lib/keycloak';
import { getMenuSocket } from '@/lib/socket';
import Switch from '@/components/ui/Switch';
import Badge from '@/components/ui/Badge';
import ItemFormModal from '@/components/menu/ItemFormModal';

interface Item {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion?: string;
  readonly precio: string;
  readonly disponible: boolean;
  readonly imagenKey?: string;
  readonly categoriaId: string;
}

interface Categoria {
  readonly id: string;
  readonly nombre: string;
  readonly activo: boolean;
  readonly orden: number;
  readonly items: readonly Item[];
}

// ============================================================================
// HELPERS: Extraídos para reducir el anidamiento a < 5 niveles (SonarQube)
// ============================================================================

const updateItemAvailability = (items: readonly Item[], itemId: string, disponible: boolean): Item[] => {
  return items.map((item) => (item.id === itemId ? { ...item, disponible } : item));
};

const updateCategoriaActivo = (categorias: readonly Categoria[], categoriaId: string, activo: boolean): Categoria[] => {
  return categorias.map((cat) => (cat.id === categoriaId ? { ...cat, activo } : cat));
};

// ============================================================================
// COMPONENTE ITEM ROW (Ya extraído previamente para reducir anidamiento)
// ============================================================================

interface ItemRowProps {
  readonly item: Item;
  readonly catId: string;
  readonly catName: string;
  readonly onEdit: (catId: string, catName: string, item: Item) => void;
  readonly onToggle: (itemId: string, current: boolean) => void;
}

function ItemRow({ item, catId, catName, onEdit, onToggle }: ItemRowProps) {
  return (
    <div className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors group">
      <div className="flex items-center gap-4 flex-1">
        <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex-shrink-0 border border-[#79767D]/20">
          {item.imagenKey ? (
            <div className="relative w-full h-full">
              <img
                src={`https://${process.env.NEXT_PUBLIC_S3_BUCKET || 'tu-bucket'}.s3.amazonaws.com/${item.imagenKey}`}
                alt={item.nombre}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#79767D]/30">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-medium ${!item.disponible ? 'text-[#79767D] line-through' : 'text-[#7C7296]'}`}>
            {item.nombre}
          </h3>
          {item.descripcion && <p className="text-sm text-[#79767D] truncate">{item.descripcion}</p>}
          <p className="text-sm font-semibold text-[#C9A74D] mt-1">${Number(item.precio).toFixed(2)}</p>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <Badge variant={item.disponible ? 'success' : 'danger'}>
          {item.disponible ? 'Disponible' : 'Agotado'}
        </Badge>
        <Switch
          checked={item.disponible}
          onChange={() => onToggle(item.id, item.disponible)}
          label={`Marcar ${item.nombre} como disponible`}
        />
        <button
          type="button"
          onClick={() => onEdit(catId, catName, item)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[#79767D] hover:text-[#8069BF]"
          title="Editar ítem"
          aria-label={`Editar ${item.nombre}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export default function AdminMenuPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [categoriaModalOpen, setCategoriaModalOpen] = useState(false);
  const [selectedCategoria, setSelectedCategoria] = useState<{ readonly id: string; readonly nombre: string } | null>(null);
  const [itemToEdit, setItemToEdit] = useState<Item | null>(null);

  const [nuevaCategoriaNombre, setNuevaCategoriaNombre] = useState('');
  const [nuevaCategoriaOrden, setNuevaCategoriaOrden] = useState('0');
  const [creandoCategoria, setCreandoCategoria] = useState(false);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const keycloak = getKeycloak();
      const restauranteId = keycloak.tokenParsed?.restaurante_id || '';
      const data = await apiFetch<Categoria[]>(`/admin/menu/categoria?restauranteId=${restauranteId}`, keycloak.token);
      setCategorias(data || []);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error desconocido al cargar el menú';
      console.error('Error cargando menú:', message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void cargarDatos();

    const keycloak = getKeycloak();
    const tenantId = keycloak.tokenParsed?.tenant_id || '';
    const socket = getMenuSocket(tenantId, keycloak.token);

    // FIX: Callbacks estrictamente síncronos para evitar advertencias de promesas no manejadas
    socket.on('menu:item:updated', (data: { itemId: string; disponible: boolean }) => {
      setCategorias((prev) =>
        prev.map((cat) => ({
          ...cat,
          items: updateItemAvailability(cat.items, data.itemId, data.disponible),
        }))
      );
      setLastUpdate(`⚡ Ítem actualizado en tiempo real — ${new Date().toLocaleTimeString('es-AR')}`);
    });

    socket.on('menu:categoria:updated', (data: { categoriaId: string; activo: boolean }) => {
      setCategorias((prev) => updateCategoriaActivo(prev, data.categoriaId, data.activo));
      setLastUpdate(`⚡ Categoría actualizada en tiempo real — ${new Date().toLocaleTimeString('es-AR')}`);
    });

    return () => {
      socket.off('menu:item:updated');
      socket.off('menu:categoria:updated');
    };
  }, []);

  const crearCategoria = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreandoCategoria(true);

    try {
      const keycloak = getKeycloak();
      await apiFetch('/admin/menu/categoria', keycloak.token, {
        method: 'POST',
        body: JSON.stringify({
          nombre: nuevaCategoriaNombre,
          orden: Number.parseInt(nuevaCategoriaOrden, 10) || 0,
        }),
      });

      setCategoriaModalOpen(false);
      setNuevaCategoriaNombre('');
      setNuevaCategoriaOrden('0');
      await cargarDatos();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error al crear la categoría';
      alert(message);
    } finally {
      setCreandoCategoria(false);
    }
  };

  const toggleItem = async (itemId: string, current: boolean) => {
    // Actualización optimista usando el helper
    setCategorias((prev) =>
      prev.map((cat) => ({
        ...cat,
        items: updateItemAvailability(cat.items, itemId, !current),
      }))
    );

    try {
      const keycloak = getKeycloak();
      await apiFetch(`/admin/menu/item/${itemId}`, keycloak.token, {
        method: 'PATCH',
        body: JSON.stringify({ disponible: !current }),
      });
    } catch (error: unknown) {
      // Revertir en caso de error
      setCategorias((prev) =>
        prev.map((cat) => ({
          ...cat,
          items: updateItemAvailability(cat.items, itemId, current),
        }))
      );
      const message = error instanceof Error ? error.message : 'Error al actualizar el ítem';
      alert(message);
    }
  };

  const toggleCategoria = async (categoriaId: string, current: boolean) => {
    setCategorias((prev) => updateCategoriaActivo(prev, categoriaId, !current));

    try {
      const keycloak = getKeycloak();
      await apiFetch(`/admin/menu/categoria/${categoriaId}`, keycloak.token, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !current }),
      });
    } catch (error: unknown) {
      setCategorias((prev) => updateCategoriaActivo(prev, categoriaId, current));
      const message = error instanceof Error ? error.message : 'Error al actualizar la categoría';
      alert(message);
    }
  };

  const openCreateModal = (categoriaId: string, categoriaNombre: string) => {
    setSelectedCategoria({ id: categoriaId, nombre: categoriaNombre });
    setItemToEdit(null);
    setModalOpen(true);
  };

  const openEditModal = (categoriaId: string, categoriaNombre: string, item: Item) => {
    setSelectedCategoria({ id: categoriaId, nombre: categoriaNombre });
    setItemToEdit(item);
    setModalOpen(true);
  };

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-[#79767D]/10 rounded animate-pulse" />
        {[1, 2].map((i) => (
          <div key={i} className="border rounded-xl p-6 space-y-4 animate-pulse">
            <div className="h-6 w-32 bg-[#79767D]/10 rounded" />
            <div className="h-20 bg-[#79767D]/5 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold text-[#7C7296]">Gestión de Carta</h1>
          <p className="text-[#79767D] mt-1">Administra categorías, ítems y disponibilidad en tiempo real.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCategoriaModalOpen(true)}
            className="px-4 py-2 bg-[#8069BF] text-white rounded-lg hover:bg-[#8069BF]/90 transition-colors shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span>Nueva categoría</span>
          </button>
          <button
            type="button"
            onClick={cargarDatos}
            className="px-4 py-2 bg-white border border-[#79767D]/30 rounded-lg text-sm font-medium text-[#7C7296] hover:bg-gray-50 transition-colors shadow-sm flex items-center gap-2"
          >
            <span>↻</span>
            <span>Actualizar vista</span>
          </button>
        </div>
      </div>

      {lastUpdate && (
        <div className="bg-[#8069BF]/10 border border-[#8069BF]/30 text-[#8069BF] px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <span className="w-2 h-2 bg-[#8069BF] rounded-full animate-pulse" />
          <span>{lastUpdate}</span>
        </div>
      )}

      {categorias.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <svg className="w-16 h-16 mx-auto text-[#79767D]/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="text-[#79767D] mb-4">No hay categorías creadas.</p>
          <button
            type="button"
            onClick={() => setCategoriaModalOpen(true)}
            className="px-6 py-3 bg-[#8069BF] text-white rounded-lg hover:bg-[#8069BF]/90 transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Crear primera categoría
          </button>
        </div>
      ) : (
        categorias.map((cat) => (
          <div
            key={cat.id}
            className={`border rounded-xl shadow-sm overflow-hidden transition-all duration-300 ${!cat.activo ? 'opacity-60 bg-gray-50' : 'bg-white'}`}
          >
            <div className="px-6 py-4 bg-[#7C7296]/5 border-b flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold text-[#7C7296]">{cat.nombre}</h2>
                {!cat.activo && <Badge variant="danger">Deshabilitada</Badge>}
                <Badge variant="neutral">{cat.items.length} ítems</Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-[#79767D]">Visible</span>
                <Switch checked={cat.activo} onChange={() => toggleCategoria(cat.id, cat.activo)} label={`Habilitar categoría ${cat.nombre}`} />
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {cat.items.length === 0 ? (
                <p className="px-6 py-8 text-center text-[#79767D] text-sm">No hay ítems en esta categoría.</p>
              ) : (
                cat.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    catId={cat.id}
                    catName={cat.nombre}
                    onEdit={openEditModal}
                    onToggle={toggleItem}
                  />
                ))
              )}
            </div>

            <div className="px-6 py-3 bg-[#7C7296]/5 border-t flex justify-between items-center">
              <button
                type="button"
                onClick={() => openCreateModal(cat.id, cat.nombre)}
                disabled={!cat.activo}
                className="text-sm font-medium text-[#8069BF] hover:text-[#8069BF]/80 flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                Agregar ítem
              </button>
            </div>
          </div>
        ))
      )}

      {modalOpen && selectedCategoria && (
        <ItemFormModal
          categoriaId={selectedCategoria.id}
          categoriaNombre={selectedCategoria.nombre}
          onClose={() => setModalOpen(false)}
          onSuccess={cargarDatos}
          itemToEdit={itemToEdit || undefined}
        />
      )}

      {categoriaModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-[#7C7296]">Nueva Categoría</h2>
              <button
                type="button"
                onClick={() => setCategoriaModalOpen(false)}
                className="text-[#79767D] hover:text-[#7C7296] transition-colors"
                aria-label="Cerrar modal"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={crearCategoria} className="p-6 space-y-4">
              <div>
                <label htmlFor="cat-nombre" className="block text-sm font-medium text-[#7C7296] mb-2">
                  Nombre de la categoría *
                </label>
                <input
                  id="cat-nombre"
                  type="text"
                  value={nuevaCategoriaNombre}
                  onChange={(e) => setNuevaCategoriaNombre(e.target.value)}
                  required
                  className="w-full px-4 py-2 border border-[#79767D]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8069BF] focus:border-transparent"
                  placeholder="Ej: Entradas, Platos principales, Postres"
                />
              </div>

              <div>
                <label htmlFor="cat-orden" className="block text-sm font-medium text-[#7C7296] mb-2">
                  Orden (opcional)
                </label>
                <input
                  id="cat-orden"
                  type="number"
                  value={nuevaCategoriaOrden}
                  onChange={(e) => setNuevaCategoriaOrden(e.target.value)}
                  min="0"
                  className="w-full px-4 py-2 border border-[#79767D]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8069BF] focus:border-transparent"
                  placeholder="0"
                />
                <p className="text-xs text-[#79767D] mt-1">Las categorías se ordenan de menor a mayor. Deja 0 para que aparezca primero.</p>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setCategoriaModalOpen(false)}
                  className="px-4 py-2 border border-[#79767D]/30 text-[#7C7296] rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creandoCategoria}
                  className="px-6 py-2 bg-[#8069BF] text-white rounded-lg hover:bg-[#8069BF]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {creandoCategoria && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Crear categoría
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
