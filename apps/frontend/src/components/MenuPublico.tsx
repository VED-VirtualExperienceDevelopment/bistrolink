'use client';

import { useState } from 'react';
import type {
  CategoriaCarta,
  ItemCarrito,
  ItemCarta,
  RestaurantePublico,
} from '@/types/menu';

interface MenuPublicoProps {
  restaurante: RestaurantePublico;
  categorias: CategoriaCarta[];
  tenantId: string;
  restauranteId: string;
}

/**
 * HU-002: Componente cliente para mostrar el menú público
 * y permitir agregar items al carrito para pedidos desde fuera del local.
 */
export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
}: MenuPublicoProps) {
  // Estado del carrito (array de items con cantidad)
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);

  /**
   * Agrega un item al carrito.
   * Si ya existe, incrementa la cantidad; si no, lo agrega con cantidad 1.
   */
  const agregarAlCarrito = (item: ItemCarta) => {
    setCarrito((prevCarrito) => {
      const itemExistente = prevCarrito.find((i) => i.itemCartaId === item.id);

      if (itemExistente) {
        // Si ya está en el carrito, incrementar cantidad
        return prevCarrito.map((i) =>
          i.itemCartaId === item.id ? { ...i, cantidad: i.cantidad + 1 } : i,
        );
      }

      // Si no está, agregarlo con cantidad 1
      return [
        ...prevCarrito,
        {
          itemCartaId: item.id,
          nombre: item.nombre,
          precio: Number(item.precio),
          cantidad: 1,
          imagenUrl: item.imagenUrl,
        },
      ];
    });
  };

  /** Calcula el total del carrito */
  const totalCarrito = carrito.reduce(
    (total, item) => total + item.precio * item.cantidad,
    0,
  );

  /** Calcula la cantidad total de items en el carrito */
  const cantidadTotalItems = carrito.reduce(
    (total, item) => total + item.cantidad,
    0,
  );

  /** Formatea un número como precio (es-UY) */
  const formatearPrecio = (valor: number) =>
    valor.toLocaleString('es-UY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header del restaurante - sticky en la parte superior */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            {restaurante.nombre}
          </h1>
          <p className="text-sm text-gray-600 mt-1 sm:text-base">
            {restaurante.direccion}
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full">
            <span className="text-sm" role="img" aria-label="Tienda">
              🛍️
            </span>
            <span className="text-sm font-medium text-blue-800">
              Pedido desde fuera del local
            </span>
          </div>
        </div>
      </header>

      {/* Contenido principal del menú */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {categorias.length === 0 ? (
          // Estado vacío: restaurante sin menú
          <div className="text-center py-16 bg-white rounded-lg shadow">
            <div className="text-6xl mb-4">🍽️</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Menú no disponible
            </h2>
            <p className="text-gray-500">
              Este restaurante aún no tiene su menú publicado.
            </p>
          </div>
        ) : (
          // Renderizar cada categoría del menú
          <div className="space-y-8">
            {categorias.map((categoria) => (
              <section
                key={categoria.id}
                className="bg-white rounded-lg shadow p-6"
              >
                <h2 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
                  {categoria.nombre}
                </h2>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {categoria.items.map((item) => (
                    <article
                      key={item.id}
                      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow flex flex-col"
                    >

                      {/* Aca puse el onError para cuando fallan las imagens en cargar, no mostrar el broken image */}
                     {item.imagenUrl && (
                      <img
                src={item.imagenUrl}
                alt={item.nombre}
                className="w-full h-48 object-cover rounded-md mb-3"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}

                      <h3 className="font-semibold text-gray-900 mb-1">
                        {item.nombre}
                      </h3>

                      {item.descripcion && (
                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                          {item.descripcion}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-auto pt-3">
                        <span className="text-lg font-bold text-gray-900">
                          ${formatearPrecio(Number(item.precio))}
                        </span>
                        <button
                          onClick={() => agregarAlCarrito(item)}
                          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                          aria-label={`Agregar ${item.nombre} al carrito`}
                        >
                          Agregar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      {/* Carrito flotante - solo visible si hay items */}
      {carrito.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">
              🛒 Tu pedido ({cantidadTotalItems}{' '}
              {cantidadTotalItems === 1 ? 'item' : 'items'})
            </h3>
            <button
              onClick={() => setCarrito([])}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
              aria-label="Vaciar carrito"
            >
              Vaciar
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto mb-3 space-y-2">
            {carrito.map((item) => (
              <div
                key={item.itemCartaId}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-medium text-gray-900">
                  {item.cantidad}x {item.nombre}
                </span>
                <span className="text-gray-500">
                  ${formatearPrecio(item.precio * item.cantidad)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-gray-900">Total:</span>
              <span className="text-xl font-bold text-gray-900">
                ${formatearPrecio(totalCarrito)}
              </span>
            </div>

            <button
              onClick={() => {
                // TODO: Implementar creación de pedido en Fase 3
                alert(
                  `Pedido listo para enviar:\n\nTenant: ${tenantId}\nRestaurante: ${restauranteId}\nItems: ${cantidadTotalItems}\nTotal: $${totalCarrito.toFixed(2)}`,
                );
              }}
              className="w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors"
            >
              Realizar pedido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}