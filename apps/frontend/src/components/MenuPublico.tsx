'use client';

import { useState } from 'react';
import type {
  CategoriaCarta,
  ItemCarrito,
  ItemCarta,
  PedidoConfirmado,
  RestaurantePublico,
} from '@/types/menu';
import { apiFetch, ApiError } from '@/lib/api-client';

interface MenuPublicoProps {
  readonly restaurante: RestaurantePublico;
  readonly categorias: readonly CategoriaCarta[];
  readonly tenantId: string;
  readonly restauranteId: string;
}

export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
}: MenuPublicoProps) {
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [estadoPedido, setEstadoPedido] = useState<
    'idle' | 'enviando' | 'confirmado' | 'error'
  >('idle');
  const [pedidoConfirmado, setPedidoConfirmado] =
    useState<PedidoConfirmado | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  const agregarAlCarrito = (item: ItemCarta) => {
    setCarrito((prevCarrito) => {
      const itemExistente = prevCarrito.some((i) => i.itemCartaId === item.id);

      if (itemExistente) {
        return prevCarrito.map((i) =>
          i.itemCartaId === item.id ? { ...i, cantidad: i.cantidad + 1 } : i,
        );
      }

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

  const totalCarrito = carrito.reduce(
    (total, item) => total + item.precio * item.cantidad,
    0,
  );

  const cantidadTotalItems = carrito.reduce(
    (total, item) => total + item.cantidad,
    0,
  );

  const formatearPrecio = (valor: number) =>
    valor.toLocaleString('es-UY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const realizarPedido = async () => {
    setEstadoPedido('enviando');
    setErrorPedido(null);

    try {
      const authRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/comensal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, restauranteId }),
        },
      );

      if (!authRes.ok) {
        throw new ApiError(
          authRes.status,
          'No pudimos identificarte para hacer el pedido. Probá de nuevo.',
        );
      }

      const { accessToken } = await authRes.json();

      const pedido = await apiFetch<PedidoConfirmado>(
        '/pedidos',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            restauranteId,
            idempotencyKey: crypto.randomUUID(),
            items: carrito.map((item) => ({
              itemCartaId: item.itemCartaId,
              cantidad: item.cantidad,
            })),
          }),
        },
      );

      setPedidoConfirmado(pedido);
      setEstadoPedido('confirmado');
      setCarrito([]);
    } catch (err) {
      setErrorPedido(
        err instanceof ApiError
          ? err.message
          : 'No pudimos enviar tu pedido. Probá de nuevo.',
      );
      setEstadoPedido('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
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

      {estadoPedido === 'confirmado' && pedidoConfirmado && (
        <div className="max-w-7xl mx-auto px-4 pt-6 sm:px-6 lg:px-8">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
            <span className="text-2xl" role="img" aria-label="Confirmado">
              ✅
            </span>
            <div>
              <p className="font-semibold text-green-900">
                ¡Pedido enviado! Cocina ya lo recibió.
              </p>
              <p className="text-sm text-green-700 mt-1">
                Estado: {pedidoConfirmado.estado}
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {categorias.length === 0 ? (
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
                      {item.imagenUrl && (
                        <img
                          src={item.imagenUrl}
                          alt={item.nombre}
                          className="w-full h-48 object-cover rounded-md mb-3"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
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
                          type="button"
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

      {carrito.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 bg-white rounded-lg shadow-xl border border-gray-200 p-4 z-20">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">
              🛒 Tu pedido ({cantidadTotalItems}{' '}
              {cantidadTotalItems === 1 ? 'item' : 'items'})
            </h3>
            <button
              type="button"
              onClick={() => setCarrito([])}
              className="text-sm text-red-600 hover:text-red-700 font-medium"
              aria-label="Vaciar carrito"
              disabled={estadoPedido === 'enviando'}
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

          {errorPedido && (
            <p className="text-sm text-red-600 mb-2" role="alert">
              {errorPedido}
            </p>
          )}

          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-gray-900">Total:</span>
              <span className="text-xl font-bold text-gray-900">
                ${formatearPrecio(totalCarrito)}
              </span>
            </div>

            <button
              type="button"
              onClick={realizarPedido}
              disabled={estadoPedido === 'enviando'}
              className="w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {estadoPedido === 'enviando' ? 'Enviando...' : 'Realizar pedido'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}