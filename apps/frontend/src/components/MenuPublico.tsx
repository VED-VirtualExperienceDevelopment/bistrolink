'use client';

import { useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type {
  CategoriaCarta,
  ItemCarrito,
  ItemCarta,
  PedidoConfirmado,
  RestaurantePublico,
} from '@/types/menu';
import { apiFetch, ApiError } from '@/lib/api-client';
import ItemImagen from './menu/ItemImagen';

const ItemNotaModal = dynamic(() => import('./ItemNotaModal'), { ssr: false });
const SeguimientoPedido = dynamic(
  () => import('./SeguimientoPedido').then(mod => ({ default: mod.SeguimientoPedido })),
  { ssr: false, loading: () => null }
);

interface MenuPublicoProps {
  readonly restaurante: RestaurantePublico;
  readonly categorias: readonly CategoriaCarta[];
  readonly tenantId: string;
  readonly restauranteId: string;
}

const MAX_CHARS_GENERAL = 500;
const MAX_CHARS_ITEM = 300;
const WARNING_THRESHOLD = 0.9;

export default function MenuPublico({
  restaurante,
  categorias,
  tenantId,
  restauranteId,
}: MenuPublicoProps) {
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [observacionGeneral, setObservacionGeneral] = useState('');
  const [itemNotaAbierto, setItemNotaAbierto] = useState<ItemCarrito | null>(null);
  const [notaTemporal, setNotaTemporal] = useState('');

  const [estadoPedido, setEstadoPedido] = useState<'idle' | 'enviando' | 'confirmado' | 'error'>('idle');
  const [pedidoConfirmado, setPedidoConfirmado] = useState<PedidoConfirmado | null>(null);
  const [tokenComensal, setTokenComensal] = useState<string | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  const generalCharCount = observacionGeneral.length;
  const isGeneralOverLimit = generalCharCount > MAX_CHARS_GENERAL;
  const isGeneralNearLimit = generalCharCount >= MAX_CHARS_GENERAL * WARNING_THRESHOLD && !isGeneralOverLimit;

  const getGeneralBorderClasses = () => {
    if (isGeneralOverLimit) return 'border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20';
    if (isGeneralNearLimit) return 'border-2 border-[#755b00] bg-[#F1ECF4] focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20';
    return 'border-2 border-[#cac4d2] bg-[#F1ECF4] focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20';
  };

  const getGeneralCounterColor = () => {
    if (isGeneralOverLimit) return 'text-[#BA1A1A]';
    if (isGeneralNearLimit) return 'text-[#755b00]';
    return 'text-gray-700';
  };

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
          observacion: '',
        },
      ];
    });
  };

  const actualizarNotaItem = useCallback((itemCartaId: string, nota: string) => {
    setCarrito((prevCarrito) => {
      const itemExistente = prevCarrito.find((i) => i.itemCartaId === itemCartaId);
      if (itemExistente?.observacion === nota) return prevCarrito;
      return prevCarrito.map((item) =>
        item.itemCartaId === itemCartaId ? { ...item, observacion: nota || undefined } : item
      );
    });
  }, []);

  const handleAbrirNotaItem = (item: ItemCarrito) => {
    setItemNotaAbierto(item);
    setNotaTemporal(item.observacion || '');
  };

  const handleGuardarNotaItem = (nota: string) => {
    if (itemNotaAbierto) {
      actualizarNotaItem(itemNotaAbierto.itemCartaId, nota);
      setItemNotaAbierto(null);
    }
  };

  const totalCarrito = useMemo(
    () => carrito.reduce((total, item) => total + item.precio * item.cantidad, 0),
    [carrito]
  );

  const cantidadTotalItems = useMemo(
    () => carrito.reduce((total, item) => total + item.cantidad, 0),
    [carrito]
  );

  const formatearPrecio = (valor: number | string) =>
    new Intl.NumberFormat('es-UY', {
      style: 'currency',
      currency: 'UYU',
      minimumFractionDigits: 0,
    }).format(Number(valor));

  const realizarPedido = async () => {
    if (isGeneralOverLimit) {
      setErrorPedido('La nota general no puede exceder 500 caracteres');
      return;
    }

    const tieneNotasInvalidas = carrito.some(
      (item) => (item.observacion || '').length > MAX_CHARS_ITEM
    );
    if (tieneNotasInvalidas) {
      setErrorPedido('Las notas de los ítems no pueden exceder 300 caracteres');
      return;
    }

    setEstadoPedido('enviando');
    setErrorPedido(null);

    try {
      const authRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/comensal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, restauranteId }),
      });

      if (!authRes.ok) throw new ApiError(authRes.status, 'No pudimos identificarte para hacer el pedido. Probá de nuevo.');

      const { accessToken } = await authRes.json();

      const pedido = await apiFetch<PedidoConfirmado>('/pedidos', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          restauranteId,
          idempotencyKey: crypto.randomUUID(),
          observacionGeneral: observacionGeneral.trim() || undefined,
          items: carrito.map((item) => ({
            itemCartaId: item.itemCartaId,
            cantidad: item.cantidad,
            observacion: item.observacion?.trim() || undefined,
          })),
        }),
      });

      setPedidoConfirmado(pedido);
      setTokenComensal(accessToken);
      setEstadoPedido('confirmado');
      setCarrito([]);
      setObservacionGeneral('');
    } catch (err) {
      setErrorPedido(err instanceof ApiError ? err.message : 'No pudimos enviar tu pedido. Probá de nuevo.');
      setEstadoPedido('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-white border-b border-gray-200">
        <div className="flex items-center gap-4">
          <span className="text-xl md:text-2xl font-bold text-brand-700">BistroLink</span>
        </div>
        <div className="flex items-center gap-4 text-brand-700">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand-700/10 rounded-full">
            <span className="text-sm font-medium">Pedido desde fuera del local</span>
          </div>
        </div>
      </nav>

      <main className="pt-20 px-4 md:px-8 max-w-[1440px] mx-auto flex flex-col gap-10">
        <section className="w-full">
          <div className="relative w-full h-[250px] md:h-[350px] rounded-[1rem] overflow-hidden group bg-gray-800">
            <div 
              className="absolute inset-0 bg-cover bg-center w-full h-full transition-transform duration-700 group-hover:scale-105"
              style={{ backgroundImage: "url('https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=80&w=1974&auto=format&fit=crop')" }}
            ></div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10"></div>
            
            <div className="absolute bottom-0 left-0 p-6 md:p-8 w-full flex flex-col justify-end">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white font-medium text-xs md:text-sm mb-3 w-max">
                📍 {restaurante.direccion}
              </span>
              <h1 className="text-3xl md:text-5xl font-bold text-white mb-2 tracking-tight">
                {restaurante.nombre}
              </h1>
            </div>
          </div>
        </section>

        {estadoPedido === 'confirmado' && pedidoConfirmado && tokenComensal && (
          <section className="w-full">
            <div className="bg-white border border-gray-200 rounded-[1rem] p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-2xl" role="img" aria-label="Confirmado">✅</span>
                <p className="font-semibold text-gray-900 text-lg">
                  ¡Pedido enviado! Cocina ya lo recibió.
                </p>
              </div>
              <SeguimientoPedido
                pedidoId={pedidoConfirmado.id}
                token={tokenComensal}
                estadoInicial={pedidoConfirmado.estado}
              />
            </div>
          </section>
        )}

        {categorias.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-[1rem] border border-gray-200">
            <div className="text-6xl mb-4">🍽️</div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Menú no disponible
            </h2>
            <p className="text-gray-600">
              Este restaurante aún no tiene su menú publicado.
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {categorias.map((categoria, categoriaIndex) => (
              <section key={categoria.id} id={`categoria-${categoria.id}`} className="w-full">
                <div className="flex items-center justify-between mb-6 border-b border-gray-200 pb-2">
                  <h2 className="text-2xl font-bold text-gray-900">
                    {categoria.nombre}
                  </h2>
                  <span className="text-sm font-medium text-gray-600">
                    {categoria.items.length} {categoria.items.length === 1 ? 'ítem' : 'ítems'}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {categoria.items.map((item, index) => (
                    <article
                      key={item.id}
                      className="bg-white rounded-[1rem] border border-gray-200 flex flex-col sm:flex-row overflow-hidden hover:shadow-md transition-shadow group"
                    >
                      <div className="w-full sm:w-2/5 h-48 sm:h-auto shrink-0 relative overflow-hidden bg-gray-100">
                        <ItemImagen
                          url={item.imagenUrl}
                          alt={item.nombre}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          priority={categoriaIndex === 0 && index === 0}
                        />
                      </div>

                      <div className="p-5 flex flex-col justify-between flex-1">
                        <div>
                          <div className="flex justify-between items-start mb-2 gap-3">
                            <h3 className="font-semibold text-lg text-foreground leading-tight">
                              {item.nombre}
                            </h3>
                            <span className="font-bold text-lg text-brand-700 shrink-0">
                              {formatearPrecio(item.precio)}
                            </span>
                          </div>
                          {item.descripcion && (
                            <p className="text-sm text-foreground/70 mb-4 line-clamp-2">
                              {item.descripcion}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col gap-3 mt-4 sm:mt-auto">
                          <button
                            type="button"
                            onClick={() => agregarAlCarrito(item)}
                            className="w-full bg-brand-700/10 text-brand-700 font-semibold py-2.5 rounded-[0.5rem] hover:bg-brand-700 hover:text-white transition-colors flex items-center justify-center gap-2"
                            aria-label={`Agregar ${item.nombre} al carrito`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19"></line>
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                            Agregar
                          </button>
                        </div>
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
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[400px] bg-white rounded-[1rem] shadow-xl border border-gray-200 p-5 z-20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2">
              <span role="img" aria-label="Carrito">🛒</span> Tu pedido ({cantidadTotalItems} {cantidadTotalItems === 1 ? 'item' : 'items'})
            </h3>
            <button
              type="button"
              onClick={() => setCarrito([])}
              className="text-sm text-red-600 hover:text-red-800 font-medium px-2 py-1 bg-red-50 rounded-md transition-colors"
              disabled={estadoPedido === 'enviando'}
            >
              Vaciar
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto mb-4 space-y-3 pr-1">
            {carrito.map((item) => (
              <div key={item.itemCartaId} className="flex flex-col bg-gray-50 p-3 rounded-lg">
                <div className="flex items-start justify-between text-sm">
                  <div className="flex-1 pr-2">
                    <span className="font-semibold text-gray-900">
                      {item.cantidad}x {item.nombre}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAbrirNotaItem(item)}
                      className="text-xs text-brand-700 mt-1.5 flex items-center gap-1 hover:underline font-medium"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                      Editar nota
                    </button>
                    {item.observacion && (
                      <p className="text-xs text-gray-600 mt-1 italic line-clamp-2">
                        &quot;{item.observacion}&quot;
                      </p>
                    )}
                  </div>
                  <span className="font-semibold text-gray-900">
                    {formatearPrecio(item.precio * item.cantidad)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-200 pt-4 mb-4">
            <label
              htmlFor="observacion-general"
              className="text-sm font-semibold text-gray-900 mb-2 block"
            >
              Instrucciones generales
            </label>
            <textarea
              id="observacion-general"
              value={observacionGeneral}
              onChange={(e) => setObservacionGeneral(e.target.value)}
              placeholder="Ej: Mesa 4. Ningún plato debe llevar maní."
              className={`w-full p-3 rounded-lg text-sm resize-none outline-none transition-all duration-200 placeholder:text-gray-400 ${getGeneralBorderClasses()}`}
              maxLength={MAX_CHARS_GENERAL + 20}
              rows={2}
            />
            <div className="flex justify-end mt-1">
              <span className={`text-xs font-semibold ${getGeneralCounterColor()}`}>
                {generalCharCount}/{MAX_CHARS_GENERAL}
              </span>
            </div>
          </div>

          {errorPedido && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm font-medium mb-4 flex items-start gap-2">
               <span>⚠️</span> {errorPedido}
            </div>
          )}

          <div className="pt-2">
            <div className="flex items-center justify-between mb-4">
              <span className="font-bold text-gray-900 text-lg">Total:</span>
              <span className="text-2xl font-bold text-brand-700">
                {formatearPrecio(totalCarrito)}
              </span>
            </div>

            <button
              type="button"
              onClick={realizarPedido}
              disabled={estadoPedido === 'enviando' || isGeneralOverLimit}
              className="w-full px-4 py-3.5 bg-brand-700 text-white font-bold rounded-[0.5rem] hover:bg-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-700/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-md"
            >
              {estadoPedido === 'enviando' ? 'Procesando...' : 'Realizar pedido'}
            </button>
          </div>
        </div>
      )}

      <ItemNotaModal
        isOpen={!!itemNotaAbierto}
        onClose={() => setItemNotaAbierto(null)}
        itemName={itemNotaAbierto?.nombre || ''}
        currentNote={notaTemporal}
        onSave={handleGuardarNotaItem}
      />
    </div>
  );
}
