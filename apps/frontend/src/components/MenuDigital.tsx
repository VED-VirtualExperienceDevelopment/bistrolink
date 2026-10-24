'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import ItemImagen from '@/components/menu/ItemImagen';
import { LlamarMozoButton } from '@/components/LlamarMozoButton';
import { apiFetch, ApiError } from '@/lib/api-client';
import {
  alcanzoCantidadMaxima,
  CANTIDAD_MAXIMA_POR_ITEM,
  esEstablecimientoSuspendido,
  etiquetaMesa,
  headersMesaQr,
  MENSAJE_RESTAURANTE_NO_DISPONIBLE,
  mensajeErrorQr,
  origenPedido,
  solicitudAuthComensal,
  sumarUnidad,
  type OrigenMenu,
} from '@/components/menu-digital.utils';
import type { PedidoConfirmado } from '@/types/menu';

const ItemNotaModal = dynamic(() => import('@/components/ItemNotaModal'), { ssr: false });
const SeguimientoPedido = dynamic(
  () => import('@/components/SeguimientoPedido').then(mod => ({ default: mod.SeguimientoPedido })),
  { ssr: false, loading: () => null }
);

export type ItemMenu = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string | number;
  disponible: boolean;
  imagenUrl: string | null;
};

export type CategoriaMenu = {
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

interface MenuDigitalProps {
  /** HU-034 (BL-204): en la mesa, solo el token del QR; ningún id. */
  readonly origen: OrigenMenu;
  readonly restaurante: { nombre: string; direccion?: string };
  readonly categorias: readonly CategoriaMenu[];
  /** Solo en la mesa: el número que se muestra en el encabezado. */
  readonly numeroMesa?: number;
}

const MAX_CHARS_GENERAL = 500;
const MAX_CHARS_ITEM = 300;
const WARNING_THRESHOLD = 0.9;

export default function MenuDigital({
  origen,
  restaurante,
  categorias,
  numeroMesa,
}: MenuDigitalProps) {
  const tipo = origen.tipo;
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [observacionGeneral, setObservacionGeneral] = useState('');
  const [itemNotaAbierto, setItemNotaAbierto] = useState<ItemCarrito | null>(null);
  const [notaTemporal, setNotaTemporal] = useState('');

  const [estadoPedido, setEstadoPedido] = useState<'idle' | 'enviando' | 'confirmado' | 'error'>('idle');
  const [pedidoConfirmado, setPedidoConfirmado] = useState<PedidoConfirmado | null>(null);
  const [tokenComensal, setTokenComensal] = useState<string | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  // BL-320: el panel "Tu pedido" es fijo y tapaba los botones "Agregar" de
  // los platos que quedaban debajo. Se mide su alto para reservar ese espacio
  // al final de la página y en el scroll (ver el efecto de abajo).
  const panelPedidoRef = useRef<HTMLDivElement>(null);
  const [altoPanelPedido, setAltoPanelPedido] = useState(0);
  const hayCarrito = carrito.length > 0;

  const generalCharCount = observacionGeneral.length;
  const isGeneralOverLimit = generalCharCount > MAX_CHARS_GENERAL;
  const isGeneralNearLimit = generalCharCount >= MAX_CHARS_GENERAL * WARNING_THRESHOLD && !isGeneralOverLimit;

  const getGeneralBorderClasses = () => {
    if (isGeneralOverLimit) return 'border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20';
    if (isGeneralNearLimit) return 'border-2 border-[#755b00] bg-culinary-background focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20';
    return 'border-2 border-culinary-neutral/30 bg-culinary-background focus:border-[#6e54ad] focus:ring-2 focus:ring-[#6e54ad]/20';
  };

  const getGeneralCounterColor = () => {
    if (isGeneralOverLimit) return 'text-[#BA1A1A]';
    if (isGeneralNearLimit) return 'text-[#755b00]';
    return 'text-[#5a575e]';
  };

  // BL-425: true si el ítem ya tiene en el carrito el máximo de unidades.
  const llegoAlTope = (itemId: string) =>
    alcanzoCantidadMaxima(
      carrito.find((i) => i.itemCartaId === itemId)?.cantidad ?? 0,
    );

  const agregarAlCarrito = (item: ItemMenu) => {
    setCarrito((prevCarrito) => {
      const itemExistente = prevCarrito.some((i) => i.itemCartaId === item.id);
      if (itemExistente) {
        return prevCarrito.map((i) =>
          // BL-425: no pasa del tope (el backend rechaza más de 99).
          i.itemCartaId === item.id ? { ...i, cantidad: sumarUnidad(i.cantidad) } : i,
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
      // BL-309 / BL-204: la ruta, el body y el header salen de
      // menu-digital.utils.ts (con test), para que no vuelvan a quedar
      // apuntando a una ruta inexistente.
      const auth = solicitudAuthComensal(origen);

      const authRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${auth.ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auth.body),
      });

      if (!authRes.ok) {
        // BL-413: establecimiento suspendido → «no disponible», no un error
        // genérico de identificación.
        const cuerpo = await authRes.json().catch(() => null);
        throw new ApiError(
          authRes.status,
          esEstablecimientoSuspendido(authRes.status, cuerpo)
            ? MENSAJE_RESTAURANTE_NO_DISPONIBLE
            : (mensajeErrorQr(origen, authRes.status) ?? 'Error al identificarte para hacer el pedido.'),
        );
      }

      const { accessToken } = await authRes.json();

      interface PedidoBody {
        idempotencyKey: string;
        observacionGeneral?: string;
        items: { itemCartaId: string; cantidad: number; observacion?: string }[];
        restauranteId?: string;
      }

      const pedidoBody: PedidoBody = {
        ...origenPedido(origen),
        idempotencyKey: crypto.randomUUID(),
        observacionGeneral: observacionGeneral.trim() || undefined,
        items: carrito.map((item) => ({
          itemCartaId: item.itemCartaId,
          cantidad: item.cantidad,
          observacion: item.observacion?.trim() || undefined,
        })),
      };

      const pedido = await apiFetch<PedidoConfirmado>('/pedidos', accessToken, {
        method: 'POST',
        headers: headersMesaQr(origen),
        body: JSON.stringify(pedidoBody),
      });

      setPedidoConfirmado(pedido);
      setTokenComensal(accessToken);
      setEstadoPedido('confirmado');
      setCarrito([]);
      setObservacionGeneral('');
    } catch (err) {
      setErrorPedido(
        err instanceof ApiError
          ? (mensajeErrorQr(origen, err.status) ?? err.message)
          : 'No pudimos enviar tu pedido. Probá de nuevo.',
      );
      setEstadoPedido('error');
    }
  };

  // BL-320: mide el panel "Tu pedido" mientras está visible.
  useEffect(() => {
    const panel = panelPedidoRef.current;
    if (!hayCarrito || !panel) {
      setAltoPanelPedido(0);
      return;
    }
    const observer = new ResizeObserver(() =>
      setAltoPanelPedido(Math.ceil(panel.getBoundingClientRect().height)),
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [hayCarrito]);

  // BL-320: scroll-padding hace que el navegador, al llevar un elemento a la
  // vista (scroll, foco con teclado, scrollIntoView), lo deje entre la barra
  // superior fija y el panel del pedido, en vez de debajo de alguno de los
  // dos. También cubre WCAG 2.4.11 (el foco no queda tapado).
  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollPaddingTop = '5rem';
    html.style.scrollPaddingBottom = altoPanelPedido
      ? `${altoPanelPedido + 32}px`
      : '';
    return () => {
      html.style.scrollPaddingTop = '';
      html.style.scrollPaddingBottom = '';
    };
  }, [altoPanelPedido]);

  return (
    <div
      className="min-h-screen bg-culinary-background pb-28"
      // BL-320: espacio al final para que el último plato pueda quedar por
      // encima del panel del pedido (pb-28 solo alcanzaba sin el panel).
      style={altoPanelPedido ? { paddingBottom: altoPanelPedido + 32 } : undefined}
    >
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-4 md:px-8 h-16 bg-white border-b border-culinary-neutral/15">
        <div className="flex items-center gap-4">
          <span className="text-xl md:text-2xl font-bold text-[#6e54ad]">BistroLink</span>
        </div>
        <div className="flex items-center gap-4 text-[#6e54ad]">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#6e54ad]/10 rounded-full">
            <span className="text-sm font-medium">
              {tipo === 'mesa' ? '📍 En el local' : 'Pedido desde fuera del local'}
            </span>
          </div>
        </div>
      </nav>

      {/* BL-320: en pantallas anchas (lg) el panel del pedido va a la
          derecha; con el carrito abierto se le reserva ese espacio para que
          la grilla del menú no quede debajo del panel. */}
      <main
        className={`pt-20 px-4 md:px-8 max-w-[1440px] mx-auto flex flex-col gap-10 ${hayCarrito ? 'lg:pr-[448px]' : ''}`}
      >
        <section className="w-full">
          <div className="relative w-full h-[250px] md:h-[350px] rounded-[1rem] overflow-hidden group bg-foreground">
            <div 
              className="absolute inset-0 bg-cover bg-center w-full h-full transition-transform duration-700 group-hover:scale-105"
              style={{ backgroundImage: "url('https://images.unsplash.com/photo-1514933651103-005eec06c04b?q=80&w=1974&auto=format&fit=crop')" }}
            ></div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10"></div>
            
            <div className="absolute bottom-0 left-0 p-6 md:p-8 w-full flex flex-col justify-end">
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-white font-medium text-xs md:text-sm mb-3 w-max">
                {tipo === 'mesa' ? etiquetaMesa(numeroMesa) : `📍 ${restaurante.direccion || 'Local'}`}
              </span>
              <h1 className="text-3xl md:text-5xl font-bold text-white mb-2 tracking-tight">
                {restaurante.nombre}
              </h1>
            </div>
          </div>
        </section>

        {estadoPedido === 'confirmado' && pedidoConfirmado && tokenComensal && (
          <section className="w-full">
            <div className="bg-white border border-culinary-neutral/15 rounded-[1rem] p-5 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]">
              <div className="flex items-start gap-3">
                <span className="text-2xl" role="img" aria-label="Confirmado">✅</span>
                <p className="font-semibold text-foreground text-lg">
                  {tipo === 'mesa' ? '¡Pedido enviado a cocina!' : '¡Pedido enviado! Cocina ya lo recibió.'}
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
          <div className="text-center py-16 bg-white rounded-[1rem] border border-culinary-neutral/15">
            <div className="text-6xl mb-4">🍽️</div>
            <h2 className="text-xl font-semibold text-foreground mb-2">Menú no disponible</h2>
            <p className="text-[#5a575e]">Este restaurante aún no tiene su menú publicado.</p>
          </div>
        ) : (
          <div className="space-y-12">
            {categorias.map((categoria, categoriaIndex) => (
              <section key={categoria.id} id={`categoria-${categoria.id}`} className="w-full">
                <div className="flex items-center justify-between mb-6 border-b border-culinary-neutral/15 pb-2">
                  <h2 className="text-2xl font-bold text-foreground">{categoria.nombre}</h2>
                  <span className="text-sm font-medium text-[#5a575e]">
                    {categoria.items.length} {categoria.items.length === 1 ? 'ítem' : 'ítems'}
                  </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {categoria.items.map((item, index) => (
                    <article
                      key={item.id}
                      {...(!item.disponible ? { 'aria-disabled': true } : {})}
                      className={`bg-white rounded-[1rem] border border-culinary-neutral/15 flex flex-col sm:flex-row overflow-hidden hover:shadow-[0px_4px_20px_rgba(121,118,125,0.08)] transition-all group ${
                        !item.disponible ? 'bg-culinary-background grayscale-[0.2]' : ''
                      }`}
                    >
                      <div className={`w-full sm:w-2/5 h-48 sm:h-auto shrink-0 relative overflow-hidden bg-culinary-background ${
                        !item.disponible ? 'opacity-50 grayscale' : ''
                      }`}>
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
                            <span className="font-bold text-lg text-[#6e54ad] shrink-0">
                              {formatearPrecio(item.precio)}
                            </span>
                          </div>
                          {item.descripcion && (
                            <p className="text-sm text-[#5a575e] mb-4 line-clamp-2">
                              {item.descripcion}
                            </p>
                          )}
                        </div>

                        <div className="mt-4 sm:mt-auto flex flex-col gap-3">
                          {!item.disponible ? (
                            <span className="inline-flex rounded-md bg-red-100 text-red-800 px-3 py-2 text-sm font-semibold items-center justify-center gap-1">
                              <span role="img" aria-label="Agotado">🚫</span> No disponible
                            </span>
                          ) : (
                            <>
                            <button
                              type="button"
                              onClick={() => agregarAlCarrito(item)}
                              // BL-425: al llegar al tope el botón se deshabilita
                              // y el aviso queda asociado con aria-describedby.
                              disabled={llegoAlTope(item.id)}
                              aria-describedby={
                                llegoAlTope(item.id)
                                  ? `tope-${item.id}`
                                  : undefined
                              }
                              aria-label={`Agregar ${item.nombre} al carrito`}
                              className="w-full bg-[#6e54ad]/10 text-[#6e54ad] font-semibold py-2.5 rounded-[0.5rem] hover:bg-[#6e54ad] hover:text-white transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#6e54ad]/10 disabled:hover:text-[#6e54ad]"
                            >
                              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                              </svg>
                              Agregar
                            </button>
                            {llegoAlTope(item.id) && (
                              <p id={`tope-${item.id}`} className="text-xs text-[#5a575e] text-center">
                                Máximo {CANTIDAD_MAXIMA_POR_ITEM} unidades por ítem.
                              </p>
                            )}
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {origen.tipo === 'mesa' && (
          <div className="mt-8 flex justify-center w-full">
            <LlamarMozoButton qrToken={origen.qrToken} />
          </div>
        )}
      </main>

      {hayCarrito && (
        <div
          ref={panelPedidoRef}
          // BL-320: hasta lg ocupa todo el ancho abajo, con un alto máximo
          // para que siempre quede menú visible arriba; desde lg va a la
          // derecha, en el espacio que se le reserva al <main>.
          className="fixed bottom-4 left-4 right-4 max-h-[60vh] overflow-y-auto lg:left-auto lg:right-4 lg:w-[400px] lg:max-h-[calc(100vh-6rem)] bg-white rounded-[1rem] shadow-[0px_4px_20px_rgba(121,118,125,0.15)] border border-culinary-neutral/15 p-5 z-20"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
              <span role="img" aria-label="Carrito">🛒</span> Tu pedido ({cantidadTotalItems} {cantidadTotalItems === 1 ? 'item' : 'items'})
            </h3>
            <button
              type="button"
              onClick={() => setCarrito([])}
              className="text-sm text-red-600 hover:text-red-700 font-medium px-2 py-1 bg-red-50 rounded-md transition-colors"
              disabled={estadoPedido === 'enviando'}
            >
              Vaciar
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto mb-4 space-y-3 pr-1">
            {carrito.map((item) => (
              <div key={item.itemCartaId} className="flex flex-col bg-culinary-background p-3 rounded-lg">
                <div className="flex items-start justify-between text-sm">
                  <div className="flex-1 pr-2">
                    <span className="font-semibold text-foreground">
                      {item.cantidad}x {item.nombre}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAbrirNotaItem(item)}
                      className="text-xs text-[#6e54ad] mt-1.5 flex items-center gap-1 hover:underline font-medium"
                    >
                      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                      Editar nota
                    </button>
                    {item.observacion && (
                      <p className="text-xs text-[#5a575e] mt-1 italic line-clamp-2">
                        &quot;{item.observacion}&quot;
                      </p>
                    )}
                  </div>
                  <span className="font-semibold text-foreground">
                    {formatearPrecio(item.precio * item.cantidad)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-culinary-neutral/15 pt-4 mb-4">
            <label htmlFor="observacion-general" className="text-sm font-semibold text-foreground mb-2 block">
              Instrucciones generales
            </label>
            <textarea
              id="observacion-general"
              value={observacionGeneral}
              onChange={(e) => setObservacionGeneral(e.target.value)}
              placeholder="Ej: Ningún plato debe llevar maní."
              className={`w-full p-3 rounded-lg text-sm resize-none outline-none transition-all duration-200 placeholder:text-[#5a575e]/70 ${getGeneralBorderClasses()}`}
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
              <span className="font-bold text-foreground text-lg">Total:</span>
              <span className="text-2xl font-bold text-[#6e54ad]">
                {formatearPrecio(totalCarrito)}
              </span>
            </div>

            <button
              type="button"
              onClick={realizarPedido}
              disabled={estadoPedido === 'enviando' || isGeneralOverLimit}
              className="w-full px-4 py-3.5 bg-[#6e54ad] text-white font-bold rounded-[0.5rem] hover:bg-[#5b468f] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg shadow-[0px_4px_20px_rgba(121,118,125,0.15)]"
            >
              {estadoPedido === 'enviando' ? 'Enviando...' : 'Realizar pedido'}
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
