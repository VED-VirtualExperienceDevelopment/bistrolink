'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { LlamarMozoButton } from '@/components/LlamarMozoButton';
import { etiquetaMesa, type OrigenMenu } from '@/components/menu-digital.utils';
import { FormularioTarjeta, IconoCandado, type DatosTarjeta } from './FormularioTarjeta';
import {
  codigoPedido,
  formatearPrecio,
  headersAccesoPedido,
  INTERVALO_CONSULTA_MS,
  resultadoDeError,
  resultadoDeEstado,
  rutaPagos,
  seguirConsultando,
  type EstadoPago,
  type EstadoPagoDelPedido,
  type ResultadoPago,
} from './pago.utils';

export interface LineaResumen {
  readonly itemCartaId: string;
  readonly nombre: string;
  readonly cantidad: number;
  readonly precio: number;
  readonly observacion?: string;
}

interface PagoPedidoProps {
  readonly origen: OrigenMenu;
  readonly pedidoId: string;
  /** Solo pedidos para retirar: el token que devolvió POST /pedidos (RD.05). */
  readonly tokenAcceso?: string;
  /** JWT del comensal técnico del tenant. */
  readonly accessToken: string;
  readonly lineas: readonly LineaResumen[];
  readonly total: number;
  readonly numeroMesa?: number;
  readonly onVolver: () => void;
  readonly onAprobado: () => void;
}

type Pantalla =
  | { tipo: 'formulario' }
  | { tipo: 'procesando' }
  | { tipo: 'rechazado'; mensaje: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'verificando'; mensaje: string; agotado: boolean };

interface PagoCreado {
  estado: EstadoPago;
}

/**
 * BL-311 (HU-007): pantalla «Pagar» del comensal (mesa o pedido para retirar).
 *
 * Prepago (RD.03): el pedido ya existe en PENDIENTE_PAGO; acá se cobra con
 * tarjeta (Mercado Pago) y, con el pago aprobado, el backend lo manda a
 * cocina. Estados:
 * - formulario / procesando: carga de la tarjeta y cobro.
 * - rechazado: la tarjeta no autorizó; no hubo cargo y se puede reintentar.
 * - verificando: la pasarela no respondió o el pago quedó pendiente; se
 *   consulta GET /pedidos/:id/pagos hasta tener el resultado real. Mientras
 *   tanto NO se ofrece pagar de nuevo (evita un doble cobro).
 */
export function PagoPedido({
  origen,
  pedidoId,
  tokenAcceso,
  accessToken,
  lineas,
  total,
  numeroMesa,
  onVolver,
  onAprobado,
}: PagoPedidoProps) {
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'formulario' });
  // Cambia en cada rechazo para volver a montar el formulario vacío (el
  // token de la tarjeta es de un solo uso).
  const [intento, setIntento] = useState(0);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  const headers = headersAccesoPedido(origen, tokenAcceso);
  const cantidadItems = lineas.reduce((acc, l) => acc + l.cantidad, 0);

  const aplicarResultado = useCallback(
    (resultado: ResultadoPago) => {
      if (resultado.tipo === 'aprobado') {
        onAprobado();
        return;
      }
      if (resultado.tipo === 'verificando') {
        setPantalla({ tipo: 'verificando', mensaje: resultado.mensaje, agotado: false });
        return;
      }
      if (resultado.tipo === 'rechazado') setIntento((n) => n + 1);
      setPantalla(resultado);
    },
    [onAprobado],
  );

  // Al cambiar de estado, el foco va al título: un lector de pantalla
  // anuncia el resultado sin que el comensal tenga que buscarlo.
  useEffect(() => {
    if (pantalla.tipo !== 'procesando') tituloRef.current?.focus();
  }, [pantalla.tipo]);

  async function pagar(datos: DatosTarjeta) {
    setPantalla({ tipo: 'procesando' });
    try {
      const pago = await apiFetch<PagoCreado>(rutaPagos(pedidoId), accessToken, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          medioPago: 'MERCADOPAGO',
          datosPasarela: datos,
        }),
      });
      aplicarResultado(resultadoDeEstado(pago.estado));
    } catch (err) {
      aplicarResultado(
        err instanceof ApiError
          ? resultadoDeError(err.status, err.message)
          : resultadoDeError(0),
      );
    }
  }

  // Verificando: consulta el estado real hasta que se resuelve o se agota.
  const verificando = pantalla.tipo === 'verificando' && !pantalla.agotado;
  useEffect(() => {
    if (!verificando) return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;
    const inicio = Date.now();

    const consultar = async () => {
      try {
        const estado = await apiFetch<EstadoPagoDelPedido>(
          rutaPagos(pedidoId),
          accessToken,
          { headers },
        );
        if (cancelado) return;
        const resultado = resultadoDeEstado(
          estado.pago?.estado,
          estado.pago?.motivoRechazo,
        );
        if (resultado.tipo !== 'verificando') {
          aplicarResultado(resultado);
          return;
        }
      } catch {
        // Un error de red no resuelve nada: se vuelve a intentar.
      }
      if (cancelado) return;
      if (seguirConsultando(inicio, Date.now())) {
        timer = setTimeout(consultar, INTERVALO_CONSULTA_MS);
      } else {
        setPantalla((p) => (p.tipo === 'verificando' ? { ...p, agotado: true } : p));
      }
    };

    timer = setTimeout(consultar, INTERVALO_CONSULTA_MS);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
    // headers se arma en cada render con los mismos valores: no es dependencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verificando, pedidoId, accessToken, aplicarResultado]);

  const bloqueado = pantalla.tipo === 'procesando' || pantalla.tipo === 'verificando';

  return (
    <div className="pt-20 pb-12 px-4 md:px-8 max-w-[1100px] mx-auto">
      <button
        type="button"
        onClick={onVolver}
        disabled={bloqueado}
        className="inline-flex items-center gap-2 text-sm font-medium text-[#5a575e] hover:text-[#6e54ad] disabled:opacity-40 disabled:cursor-not-allowed mb-6"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <path d="m12 19-7-7 7-7" />
        </svg>
        Volver a la carta
      </button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex flex-col gap-6">
          <section className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]">
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#5a575e]">
                {origen.tipo === 'mesa' ? etiquetaMesa(numeroMesa) : 'Pedido para retirar'}
              </span>
              <span className="text-xs font-semibold text-[#6e54ad] bg-[#6e54ad]/10 px-2.5 py-1 rounded-full">
                Pedido {codigoPedido(pedidoId)}
              </span>
            </div>
            <h1
              ref={tituloRef}
              tabIndex={-1}
              className="text-2xl md:text-3xl font-bold text-foreground tracking-tight outline-none"
            >
              {tituloDe(pantalla)}
            </h1>
            <p className="mt-1 text-sm text-[#5a575e]">{bajadaDe(pantalla)}</p>

            {pantalla.tipo === 'rechazado' && (
              <AvisoRechazo mensaje={pantalla.mensaje} total={total} />
            )}
            {pantalla.tipo === 'error' && (
              <p role="alert" className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
                {pantalla.mensaje}
              </p>
            )}
          </section>

          {pantalla.tipo === 'verificando' ? (
            <Verificando
              mensaje={pantalla.mensaje}
              agotado={pantalla.agotado}
              onReintentarConsulta={() =>
                setPantalla({ ...pantalla, agotado: false })
              }
            />
          ) : (
            <section
              aria-labelledby="metodo-pago"
              className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]"
            >
              <div className="flex items-center justify-between gap-3 mb-5">
                <h2 id="metodo-pago" className="text-lg font-bold text-foreground">
                  Tarjeta de crédito o débito
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 text-xs text-[#5a575e] shrink-0">
                  <IconoCandado /> Pago protegido
                </span>
              </div>
              <FormularioTarjeta
                key={intento}
                monto={total}
                procesando={pantalla.tipo === 'procesando'}
                textoBoton={
                  pantalla.tipo === 'rechazado'
                    ? `Reintentar pago (${formatearPrecio(total)})`
                    : undefined
                }
                onPagar={pagar}
              />
            </section>
          )}

          {origen.tipo === 'mesa' && pantalla.tipo === 'rechazado' && (
            <section className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-[#5a575e]">
                ¿Preferís pagar en efectivo o con el POS del local?
              </p>
              <LlamarMozoButton
              qrToken={origen.qrToken}
              sesionMesa={origen.sesionMesa}
            />
            </section>
          )}
        </div>

        <ResumenPedido lineas={lineas} total={total} cantidadItems={cantidadItems} />
      </div>
    </div>
  );
}

function tituloDe(pantalla: Pantalla): string {
  switch (pantalla.tipo) {
    case 'rechazado':
      return 'No se pudo completar el cobro';
    case 'verificando':
      return 'Estamos confirmando tu pago';
    case 'procesando':
      return 'Procesando tu pago…';
    default:
      return 'Pagá tu pedido';
  }
}

function bajadaDe(pantalla: Pantalla): string {
  switch (pantalla.tipo) {
    case 'rechazado':
      return 'No te preocupes: no se realizó ningún cargo y tu pedido sigue guardado.';
    case 'verificando':
      return 'Tu pedido está guardado. En cuanto se confirme el pago, pasa a cocina.';
    default:
      return 'Tu pedido pasa a cocina apenas se aprueba el pago.';
  }
}

function AvisoRechazo({ mensaje, total }: { readonly mensaje: string; readonly total: number }) {
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-3 rounded-[0.75rem] bg-[#FFDAD6]/60 border border-[#BA1A1A]/20 p-4"
    >
      <span className="shrink-0 grid place-items-center w-10 h-10 rounded-full bg-white text-[#BA1A1A]">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="m3 3 18 18" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#93000a]">{mensaje}</p>
        <p className="mt-1 text-xs text-[#5a575e]">
          Monto pendiente: <span className="font-semibold text-foreground">{formatearPrecio(total)}</span>
        </p>
      </div>
    </div>
  );
}

function Verificando({
  mensaje,
  agotado,
  onReintentarConsulta,
}: {
  readonly mensaje: string;
  readonly agotado: boolean;
  readonly onReintentarConsulta: () => void;
}) {
  return (
    <section
      aria-live="polite"
      className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-6 md:p-8 shadow-[0px_4px_20px_rgba(121,118,125,0.08)] flex flex-col items-center text-center gap-4"
    >
      <span className="grid place-items-center w-16 h-16 rounded-full bg-culinary-primary-container text-[#6e54ad]">
        <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={agotado ? '' : 'animate-pulse'}>
          <path d="M6 2h12" />
          <path d="M6 22h12" />
          <path d="M6 2v4a6 6 0 0 0 12 0V2" />
          <path d="M6 22v-4a6 6 0 0 1 12 0v4" />
        </svg>
      </span>
      {agotado ? (
        <>
          <p className="text-sm text-[#5a575e] max-w-sm">
            Todavía no tenemos la confirmación de Mercado Pago. Si el pago se
            aprobó, tu pedido pasa a cocina igual. No vuelvas a pagar: consultá
            de nuevo en un momento o pedile ayuda al personal.
          </p>
          <button
            type="button"
            onClick={onReintentarConsulta}
            className="px-5 py-2.5 bg-[#6e54ad]/10 text-[#6e54ad] font-semibold rounded-[0.5rem] hover:bg-[#6e54ad] hover:text-white transition-colors"
          >
            Volver a consultar
          </button>
        </>
      ) : (
        <p className="text-sm text-[#5a575e] max-w-sm">{mensaje}</p>
      )}
    </section>
  );
}

function ResumenPedido({
  lineas,
  total,
  cantidadItems,
}: {
  readonly lineas: readonly LineaResumen[];
  readonly total: number;
  readonly cantidadItems: number;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <aside
      aria-labelledby="resumen-pedido"
      className="order-first lg:order-none bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)] lg:sticky lg:top-24"
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-controls="resumen-lineas"
        className="w-full flex items-center justify-between gap-3 lg:pointer-events-none"
      >
        <span className="flex items-center gap-2">
          <h2 id="resumen-pedido" className="text-lg font-bold text-foreground">
            Tu pedido
          </h2>
          <span className="text-xs font-semibold text-[#6e54ad] bg-[#6e54ad]/10 px-2 py-0.5 rounded-full">
            {cantidadItems} {cantidadItems === 1 ? 'ítem' : 'ítems'}
          </span>
        </span>
        <span className="flex items-center gap-2 lg:hidden">
          <span className="font-bold text-[#6e54ad]">{formatearPrecio(total)}</span>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-[#5a575e] transition-transform ${abierto ? 'rotate-180' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div id="resumen-lineas" className={`${abierto ? 'block' : 'hidden'} lg:block`}>
        <ul className="mt-4 divide-y divide-culinary-neutral/15 border-t border-culinary-neutral/15">
          {lineas.map((l) => (
            <li key={l.itemCartaId} className="py-3 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {l.cantidad}× {l.nombre}
                </p>
                {l.observacion && (
                  <p className="text-xs text-[#5a575e] italic line-clamp-2">“{l.observacion}”</p>
                )}
              </div>
              <span className="font-semibold text-foreground shrink-0">
                {formatearPrecio(l.precio * l.cantidad)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 pt-4 border-t border-culinary-neutral/15 flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#5a575e]">
              Total a pagar
            </p>
            <p className="text-xs text-[#5a575e]">IVA incluido</p>
          </div>
          <p className="text-3xl font-bold text-[#6e54ad]">{formatearPrecio(total)}</p>
        </div>
      </div>
    </aside>
  );
}
