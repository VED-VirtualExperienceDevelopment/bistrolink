'use client';

import { useState, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import ItemImagen from '@/components/menu/ItemImagen';
import { LlamarMozoButton } from '@/components/LlamarMozoButton';
import { apiFetch, ApiError } from '@/lib/api-client';

// Modifica las rutas de estos imports si tus componentes están en otra carpeta
const ItemNotaModal = dynamic(() => import('@/components/ItemNotaModal'), { ssr: false });
const SeguimientoPedido = dynamic(
  () => import('@/components/SeguimientoPedido').then(mod => ({ default: mod.SeguimientoPedido })),
  { ssr: false, loading: () => null }
);

type ItemMenu = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  disponible: boolean;
  imagenUrl: string | null;
};

type CategoriaMenu = {
  id: string;
  nombre: string;
  items: ItemMenu[];
};

type ItemCarrito = {
  itemCartaId: string;
  nombre: string;
  precio: number;
  cantidad: number;
  imagenUrl: string | null;
  observacion?: string;
};

interface MenuMesaClienteProps {
  readonly restaurante: { nombre: string };
  readonly categorias: CategoriaMenu[];
  readonly tenantId: string;
  readonly mesaId: string;
}

const MAX_CHARS_GENERAL = 500;
const MAX_CHARS_ITEM = 300;
const WARNING_THRESHOLD = 0.9;

export default function MenuMesaCliente({
  restaurante,
  categorias,
  tenantId,
  mesaId,
}: MenuMesaClienteProps) {
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [observacionGeneral, setObservacionGeneral] = useState('');
  const [itemNotaAbierto, setItemNotaAbierto] = useState<ItemCarrito | null>(null);
  const [notaTemporal, setNotaTemporal] = useState('');

  const [estadoPedido, setEstadoPedido] = useState<'idle' | 'enviando' | 'confirmado' | 'error'>('idle');
  const [pedidoConfirmado, setPedidoConfirmado] = useState<any | null>(null);
  const [tokenComensal, setTokenComensal] = useState<string | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  const generalCharCount = observacionGeneral.length;
  const isGeneralOverLimit = generalCharCount > MAX_CHARS_GENERAL;
  const isGeneralNearLimit = generalCharCount >= MAX_CHARS_GENERAL * WARNING_THRESHOLD && !isGeneralOverLimit;

  const getGeneralBorderClasses = () => {
    if (isGeneralOverLimit) return 'border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20';
    if (isGeneralNearLimit) return 'border-2 border-[#755b00] bg-[#F1ECF4] focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20';
    return 'border-2 border-[#cac4d2] bg-[#F1ECF4] focus:border-[#644da1] focus:ring-2 focus:ring-[#644da1]/20';
  };

  const getGeneralCounterColor = () => {
    if (isGeneralOverLimit) return 'text-[#BA1A1A]';
    if (isGeneralNearLimit) return 'text-[#755b00]';
    return 'text-[#494551]';
  };

  const agregarAlCarrito = (item: ItemMenu) => {
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
    Number(valor).toLocaleString('es-UY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const realizarPedido = async () => {
    if (isGeneralOverLimit) {
      setErrorPedido('La nota general no puede exceder 500 caracteres');
      return;
    }

    setEstadoPedido('enviando');
    setErrorPedido(null);

    try {
      const authRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/comensal/mesa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, mesaId }),
      });

      if (!authRes.ok) throw new ApiError(authRes.status, 'Error al identificarte en la mesa.');

      const { accessToken } = await authRes.json();

      const pedido = await apiFetch<any>('/pedidos', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          mesaId, // Enviamos el ID de la mesa al backend
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
    <div className="min-h-screen bg-culinary-background pb-28">
      {/* Top Navbar Simplificado sin scroll de categorías */}
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-white border-b border-culinary-neutral/10">
        <div className="flex items-center gap-4">
          <span className="text-xl md:text-2xl font-bold text-culinary-primary">BistroLink</span>
        </div>
        <div className="flex items-center gap-4 text-culinary-primary">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-culinary-primary/10 rounded-full">
            <span className="text-sm font-medium">📍 En el local</span>
          </div>
        </div>
      </nav>

      <main className="pt-20 px-4 md:px-8 max-w-[1440px] mx-auto flex flex-col gap-10">
        {/* Hero Section Banner */}
        <section className="w-full">
          <div className="relative w-full h-[250px] md:h-[350px] rounded-[1rem] overflow-hidden group bg-culinary-neutral/80">
            <div 
              className="absolute inset-0 bg-cover bg-center w-full h-full transition-transform duration-700 group-hover:scale-105"
              style={{ backgroundImage: "url('https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=80&w=1974&auto=format&fit=crop')" }}
            ></div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10"></div>
            
            <div className="absolute bottom-0 left-0 p-6 md:p-8 w-full flex flex-col justify-end">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white font-medium text-xs md:text-sm mb-3 w-max">
                Mesa asignada
              </span>
              <h1 className="text-3xl md:text-5xl font-bold text-white mb-2 tracking-tight">
                {restaurante.nombre}
              </h1>
            </div>
          </div>
        </section>

        {estadoPedido === 'confirmado' && pedidoConfirmado && tokenComensal && (
          <section className="w-full">
            <div className="bg-white border border-culinary-neutral/10 rounded-[1rem] p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="text-2xl" role="img" aria-label="Confirmado">✅</span>
                <p className="font-semibold text-culinary-on-surface text-lg">
                  ¡Pedido enviado a cocina!
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

        <div className="space-y-12">
          {categorias.map((categoria, categoriaIndex) => (
            <section key={categoria.id} id={`categoria-${categoria.id}`} className="w-full">
              <div className="flex items-center justify-between mb-6 border-b border-culinary-neutral/10 pb-2">
                <h2 className="text-2xl font-bold text-culinary-on-surface">{categoria.nombre}</h2>
                <span className="text-sm font-medium text-culinary-neutral">
                  {categoria.items.length} {categoria.items.length === 1 ? 'ítem' : 'ítems'}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {categoria.items.map((item, index) => (
                  <article
                    key={item.id}
                    className={`bg-white rounded-[1rem] border border-culinary-neutral/15 flex flex-col sm:flex-row overflow-hidden hover:shadow-[0px_4px_20px_rgba(121,118,125,0.08)] transition-all group ${
                      !item.disponible ? 'opacity-60 grayscale-[0.5]' : ''
                    }`}
                    aria-disabled={!item.disponible}
                  >
                    {/* Contenedor sin validación de URL para que el placeholder se muestre siempre */}
                    <div className="w-full sm:w-2/5 h-48 sm:h-auto shrink-0 relative overflow-hidden bg-culinary-neutral/5">
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
                          <h3 className="font-semibold text-lg text-culinary-on-surface leading-tight">
                            {item.nombre}
                          </h3>
                          <span className="font-bold text-lg text-culinary-primary shrink-0">
                            ${formatearPrecio(item.precio)}
                          </span>
                        </div>
                        {item.descripcion && (
                          <p className="text-sm text-culinary-neutral mb-4 line-clamp-2">
                            {item.descripcion}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 sm:mt-auto flex flex-col gap-3">
                        {!item.disponible ? (
                          <span className="inline-flex rounded-md bg-error/10 text-error px-3 py-2.5 text-sm font-semibold items-center justify-center gap-1">
                            <span role="img" aria-label="Agotado">🚫</span> Agotado
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => agregarAlCarrito(item)}
                            className="w-full bg-culinary-primary/10 text-culinary-primary font-semibold py-2.5 rounded-[0.5rem] hover:bg-culinary-primary hover:text-white transition-colors flex items-center justify-center gap-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="12" y1="5" x2="12" y2="19"></line>
                              <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                            Agregar
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8 flex justify-center w-full">
          <LlamarMozoButton tenantId={tenantId} mesaId={mesaId} />
        </div>
      </main>

      {/* Cart Sidebar */}
      {carrito.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[400px] bg-white rounded-[1rem] shadow-[0px_8px_30px_rgba(0,0,0,0.12)] border border-culinary-neutral/10 p-5 z-20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg text-culinary-on-surface flex items-center gap-2">
              <span role="img" aria-label="Carrito">🛒</span> Tu pedido ({cantidadTotalItems})
            </h3>
            <button
              type="button"
              onClick={() => setCarrito([])}
              className="text-sm text-error hover:opacity-80 font-medium px-2 py-1 bg-error/10 rounded-md transition-colors"
              disabled={estadoPedido === 'enviando'}
            >
              Vaciar
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto mb-4 space-y-3 pr-1">
            {carrito.map((item) => (
              <div key={item.itemCartaId} className="flex flex-col bg-culinary-neutral/5 p-3 rounded-lg">
                <div className="flex items-start justify-between text-sm">
                  <div className="flex-1 pr-2">
                    <span className="font-semibold text-culinary-on-surface">
                      {item.cantidad}x {item.nombre}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAbrirNotaItem(item)}
                      className="text-xs text-culinary-primary mt-1.5 flex items-center gap-1 hover:underline font-medium"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                      {item.observacion ? 'Editar nota' : 'Añadir nota'}
                    </button>
                    {item.observacion && (
                      <p className="text-xs text-culinary-neutral mt-1 italic line-clamp-2">
                        "{item.observacion}"
                      </p>
                    )}
                  </div>
                  <span className="font-semibold text-culinary-on-surface">
                    ${formatearPrecio(item.precio * item.cantidad)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-culinary-neutral/10 pt-4 mb-4">
            <label htmlFor="observacion-general" className="text-sm font-semibold text-culinary-on-surface mb-2 block">
              Instrucciones generales
            </label>
            <textarea
              id="observacion-general"
              value={observacionGeneral}
              onChange={(e) => setObservacionGeneral(e.target.value)}
              placeholder="Ej: Ningún plato debe llevar maní."
              className={`w-full p-3 rounded-lg text-sm resize-none outline-none transition-all duration-200 placeholder:text-culinary-neutral/60 ${getGeneralBorderClasses()}`}
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
            <div className="p-3 bg-error/10 text-error rounded-lg text-sm font-medium mb-4 flex items-start gap-2">
               <span>⚠️</span> {errorPedido}
            </div>
          )}

          <div className="pt-2">
            <div className="flex items-center justify-between mb-4">
              <span className="font-bold text-culinary-on-surface text-lg">Total:</span>
              <span className="text-2xl font-bold text-culinary-primary">
                ${formatearPrecio(totalCarrito)}
              </span>
            </div>

            <button
              type="button"
              onClick={realizarPedido}
              disabled={estadoPedido === 'enviando' || isGeneralOverLimit}
              className="w-full px-4 py-3.5 bg-culinary-primary text-white font-bold rounded-[0.5rem] hover:opacity-90 focus:outline-none focus:ring-4 focus:ring-culinary-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-md"
            >
              {estadoPedido === 'enviando' ? 'Enviando...' : 'Pedir a cocina'}
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
