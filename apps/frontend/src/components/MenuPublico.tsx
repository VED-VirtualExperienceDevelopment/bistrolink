'use client';

import { useState, useCallback, useMemo } from 'react';
import { Inter, Public_Sans } from 'next/font/google';
import type {
  CategoriaCarta,
  ItemCarrito,
  ItemCarta,
  PedidoConfirmado,
  RestaurantePublico,
} from '@/types/menu';
import { apiFetch, ApiError } from '@/lib/api-client';
import ItemNotaModal from './ItemNotaModal';

const inter = Inter({ subsets: ['latin'], weight: ['600', '700', '800'] });
const publicSans = Public_Sans({ subsets: ['latin'], weight: ['500', '600'] });

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
  // Estado del carrito
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  
  // BL-155: Estado para observación general del pedido
  const [observacionGeneral, setObservacionGeneral] = useState('');
  
  // BL-155: Estado para el modal de notas por ítem
  const [itemNotaAbierto, setItemNotaAbierto] = useState<ItemCarrito | null>(null);
  const [notaTemporal, setNotaTemporal] = useState('');
  
  // Estado del pedido
  const [estadoPedido, setEstadoPedido] = useState<
    'idle' | 'enviando' | 'confirmado' | 'error'
  >('idle');
  const [pedidoConfirmado, setPedidoConfirmado] =
    useState<PedidoConfirmado | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  // BL-155: Validaciones de caracteres en tiempo real
  const generalCharCount = observacionGeneral.length;
  const isGeneralOverLimit = generalCharCount > MAX_CHARS_GENERAL;
  const isGeneralNearLimit =
    generalCharCount >= MAX_CHARS_GENERAL * WARNING_THRESHOLD &&
    !isGeneralOverLimit;

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
          observacion: '', // BL-155: Inicializar observación vacía
        },
      ];
    });
  };

  // BL-155: Función para actualizar nota de un ítem
  const actualizarNotaItem = useCallback((itemCartaId: string, nota: string) => {
    setCarrito((prevCarrito) => {
      const itemExistente = prevCarrito.find(
        (i) => i.itemCartaId === itemCartaId
      );
      if (itemExistente?.observacion === nota) {
        return prevCarrito;
      }

      return prevCarrito.map((item) =>
        item.itemCartaId === itemCartaId
          ? { ...item, observacion: nota || undefined }
          : item
      );
    });
  }, []);

  // BL-155: Abrir modal para editar nota de un ítem
  const handleAbrirNotaItem = (item: ItemCarrito) => {
    setItemNotaAbierto(item);
    setNotaTemporal(item.observacion || '');
  };

  // BL-155: Guardar nota del ítem desde el modal
  // FIX Bug #2: Ahora acepta el parámetro 'nota' que viene del modal
  const handleGuardarNotaItem = (nota: string) => {
    if (itemNotaAbierto) {
      actualizarNotaItem(itemNotaAbierto.itemCartaId, nota);
      setItemNotaAbierto(null);
    }
  };

  const totalCarrito = useMemo(
    () =>
      carrito.reduce((total, item) => total + item.precio * item.cantidad, 0),
    [carrito]
  );

  const cantidadTotalItems = useMemo(
    () => carrito.reduce((total, item) => total + item.cantidad, 0),
    [carrito]
  );

  const formatearPrecio = (valor: number) =>
    valor.toLocaleString('es-UY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const realizarPedido = async () => {
    // BL-155: Validar antes de enviar
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
            observacionGeneral: observacionGeneral.trim() || undefined, // BL-155
            items: carrito.map((item) => ({
              itemCartaId: item.itemCartaId,
              cantidad: item.cantidad,
              observacion: item.observacion?.trim() || undefined, // BL-155
            })),
          }),
        },
      );

      setPedidoConfirmado(pedido);
      setEstadoPedido('confirmado');
      setCarrito([]);
      setObservacionGeneral(''); // BL-155: Limpiar observación general
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
    <div className="min-h-screen bg-culinary-background">
      <header className="bg-culinary-primary shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1
            className={`${inter.className} text-2xl font-bold text-white sm:text-3xl`}
          >
            {restaurante.nombre}
          </h1>
          <p
            className={`${publicSans.className} text-sm text-white/80 mt-1 sm:text-base`}
          >
            {restaurante.direccion}
          </p>
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-white/15 border border-white/25 rounded-full">
            <span className="text-sm" role="img" aria-label="Tienda">
              🛍️
            </span>
            <span
              className={`${publicSans.className} text-sm font-medium text-white`}
            >
              Pedido desde fuera del local
            </span>
          </div>
        </div>
      </header>

      {estadoPedido === 'confirmado' && pedidoConfirmado && (
        <div className="max-w-7xl mx-auto px-4 pt-6 sm:px-6 lg:px-8">
          <div className="bg-green-50 border border-green-200 rounded-[1rem] p-4 flex items-start gap-3">
            <span className="text-2xl" role="img" aria-label="Confirmado">
              ✅
            </span>
            <div>
              <p
                className={`${inter.className} font-semibold text-green-900`}
              >
                ¡Pedido enviado! Cocina ya lo recibió.
              </p>
              <p
                className={`${publicSans.className} text-sm text-green-700 mt-1`}
              >
                Estado: {pedidoConfirmado.estado}
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {categorias.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-[1rem] border border-culinary-neutral/10">
            <div className="text-6xl mb-4">🍽️</div>
            <h2
              className={`${inter.className} text-xl font-semibold text-culinary-on-surface mb-2`}
            >
              Menú no disponible
            </h2>
            <p className={`${publicSans.className} text-culinary-neutral`}>
              Este restaurante aún no tiene su menú publicado.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {categorias.map((categoria) => (
              <section
                key={categoria.id}
                className="bg-white rounded-[1rem] border border-culinary-neutral/10 p-6"
              >
                <h2
                  className={`${inter.className} text-xl font-bold text-culinary-on-surface mb-4 pb-2 border-b border-culinary-neutral/10`}
                >
                  {categoria.nombre}
                </h2>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {categoria.items.map((item) => (
                    <article
                      key={item.id}
                      className="border border-culinary-neutral/15 rounded-[1rem] p-4 hover:border-culinary-primary/40 transition-colors flex flex-col"
                    >
                      {item.imagenUrl && (
                        <img
                          src={item.imagenUrl}
                          alt={item.nombre}
                          className="w-full h-48 object-cover rounded-[0.5rem] mb-3"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}

                      <h3
                        className={`${inter.className} font-semibold text-culinary-on-surface mb-1`}
                      >
                        {item.nombre}
                      </h3>

                      {item.descripcion && (
                        <p
                          className={`${publicSans.className} text-sm text-culinary-neutral mb-2 line-clamp-2`}
                        >
                          {item.descripcion}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-auto pt-3">
                        <span
                          className={`${inter.className} text-lg font-bold text-culinary-primary`}
                        >
                          ${formatearPrecio(Number(item.precio))}
                        </span>
                        <button
                          type="button"
                          onClick={() => agregarAlCarrito(item)}
                          className={`${publicSans.className} px-4 py-2 bg-culinary-primary text-white text-sm font-medium rounded-[0.5rem] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-culinary-primary focus:ring-offset-2 transition-opacity`}
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
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 bg-white rounded-[1rem] shadow-[0px_4px_20px_rgba(121,118,125,0.12)] border border-culinary-neutral/10 p-4 z-20">
          <div className="flex items-center justify-between mb-3">
            <h3
              className={`${inter.className} font-semibold text-culinary-on-surface`}
            >
              🛒 Tu pedido ({cantidadTotalItems}{' '}
              {cantidadTotalItems === 1 ? 'item' : 'items'})
            </h3>
            <button
              type="button"
              onClick={() => setCarrito([])}
              className={`${publicSans.className} text-sm text-error hover:opacity-80 font-medium`}
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
                className={`${publicSans.className} flex items-center justify-between text-sm`}
              >
                <div className="flex-1">
                  <span className="font-medium text-culinary-on-surface">
                    {item.cantidad}x {item.nombre}
                  </span>
                  {/* BL-155: Mostrar indicador si tiene nota */}
                  {item.observacion && (
                    <div className="text-xs text-culinary-primary mt-1 flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </svg>
                      <span className="truncate">{item.observacion}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-culinary-neutral">
                    ${formatearPrecio(item.precio * item.cantidad)}
                  </span>
                  {/* BL-155: Botón para editar nota */}
                  <button
                    type="button"
                    onClick={() => handleAbrirNotaItem(item)}
                    className="text-culinary-primary hover:opacity-80 transition-opacity"
                    aria-label={`Editar nota de ${item.nombre}`}
                    title="Editar nota"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* BL-155: Campo de observación general */}
          <div className="border-t border-culinary-neutral/10 pt-3 mb-3">
            <label
              htmlFor="observacion-general"
              className={`${publicSans.className} text-sm font-semibold text-culinary-on-surface mb-2 block`}
            >
              Instrucciones generales (alergias, preferencias de la mesa)
            </label>
            <textarea
              id="observacion-general"
              value={observacionGeneral}
              onChange={(e) => setObservacionGeneral(e.target.value)}
              placeholder="Ej: Ningún plato debe llevar maní. Mesa 4."
              className={`w-full p-3 rounded-lg ${publicSans.className} text-sm resize-none outline-none transition-all duration-200 text-[#1C1B20] placeholder:text-[#7a7582]
                ${
                  isGeneralOverLimit
                    ? 'border-2 border-[#BA1A1A] bg-[#FFDAD6] focus:border-[#BA1A1A] focus:ring-2 focus:ring-[#BA1A1A]/20'
                    : isGeneralNearLimit
                    ? 'border-2 border-[#755b00] bg-[#F1ECF4] focus:border-[#755b00] focus:ring-2 focus:ring-[#755b00]/20'
                    : 'border-2 border-[#cac4d2] bg-[#F1ECF4] focus:border-[#644da1] focus:ring-2 focus:ring-[#644da1]/20'
                }`}
              maxLength={MAX_CHARS_GENERAL + 20}
              rows={3}
            />
            <div className="flex justify-end mt-1">
              <span
                className={`${publicSans.className} text-xs font-semibold
                  ${
                    isGeneralOverLimit
                      ? 'text-[#BA1A1A]'
                      : isGeneralNearLimit
                      ? 'text-[#755b00]'
                      : 'text-[#494551]'
                  }`}
              >
                {generalCharCount}/{MAX_CHARS_GENERAL}
              </span>
            </div>
          </div>

          {errorPedido && (
            <p
              className={`${publicSans.className} text-sm text-error mb-2`}
              role="alert"
            >
              {errorPedido}
            </p>
          )}

          <div className="border-t border-culinary-neutral/10 pt-3">
            <div className="flex items-center justify-between mb-3">
              <span
                className={`${inter.className} font-bold text-culinary-on-surface`}
              >
                Total:
              </span>
              <span
                className={`${inter.className} text-xl font-bold text-culinary-primary`}
              >
                ${formatearPrecio(totalCarrito)}
              </span>
            </div>

            <button
              type="button"
              onClick={realizarPedido}
              disabled={estadoPedido === 'enviando' || isGeneralOverLimit}
              className={`${publicSans.className} w-full px-4 py-3 bg-culinary-primary text-white font-semibold rounded-[0.5rem] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-culinary-primary focus:ring-offset-2 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {estadoPedido === 'enviando'
                ? 'Enviando...'
                : 'Realizar pedido'}
            </button>
          </div>
        </div>
      )}

      {/* BL-155: Modal para notas por ítem */}
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
