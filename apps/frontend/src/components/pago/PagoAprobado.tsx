'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '@/lib/api-client';
import { etiquetaMesa, type OrigenMenu } from '@/components/menu-digital.utils';
import type { LineaResumen } from './PagoPedido';
import {
  codigoPedido,
  estadoComprobante,
  formatearPrecio,
  headersAccesoPedido,
  INTERVALO_CONSULTA_MS,
  rutaPagos,
  seguirConsultando,
  type EstadoComprobante,
  type EstadoPagoDelPedido,
} from './pago.utils';

// Usa socket.io (solo en el navegador), igual que en la carta.
const SeguimientoPedido = dynamic(
  () => import('@/components/SeguimientoPedido').then((mod) => ({ default: mod.SeguimientoPedido })),
  { ssr: false, loading: () => null },
);

interface PagoAprobadoProps {
  readonly origen: OrigenMenu;
  readonly pedidoId: string;
  /** Solo pedidos para retirar: el token que devolvió POST /pedidos (RD.05). */
  readonly tokenAcceso?: string;
  /** JWT del comensal técnico del tenant. */
  readonly accessToken: string;
  readonly lineas: readonly LineaResumen[];
  readonly total: number;
  readonly numeroMesa?: number;
  readonly onOtroPedido: () => void;
}

const CLASE_TARJETA =
  'bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]';

/**
 * BL-311 (HU-007): pantalla de pago aprobado. El pedido ya está en cocina
 * (RECIBIDO): se muestra el código del pedido, el estado en vivo, lo que se
 * pagó y el comprobante fiscal (e-Ticket).
 *
 * El CFE puede llegar unos segundos después del pago (lo emite Surtec, a
 * veces en segundo plano desde el webhook): se consulta GET
 * /pedidos/:id/pagos cada pocos segundos hasta que aparece, con tope.
 * «CFE disponible» = emitido y firmado por el proveedor (BL-212), no
 * aceptado por DGI.
 */
export function PagoAprobado({
  origen,
  pedidoId,
  tokenAcceso,
  accessToken,
  lineas,
  total,
  numeroMesa,
  onOtroPedido,
}: PagoAprobadoProps) {
  const [comprobante, setComprobante] = useState<EstadoComprobante>({ tipo: 'emitiendo' });
  const [agotado, setAgotado] = useState(false);
  const [consulta, setConsulta] = useState(0);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  useEffect(() => {
    if (comprobante.tipo === 'emitido') return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout>;
    const inicio = Date.now();
    const headers = headersAccesoPedido(origen, tokenAcceso);

    const consultar = async () => {
      try {
        const estado = await apiFetch<EstadoPagoDelPedido>(rutaPagos(pedidoId), accessToken, { headers });
        if (cancelado) return;
        const resultado = estadoComprobante(estado);
        if (resultado.tipo === 'emitido') {
          setComprobante(resultado);
          return;
        }
      } catch {
        // Un error de red no cambia nada: se vuelve a intentar.
      }
      if (cancelado) return;
      if (seguirConsultando(inicio, Date.now())) {
        timer = setTimeout(consultar, INTERVALO_CONSULTA_MS);
      } else {
        setAgotado(true);
      }
    };

    setAgotado(false);
    void consultar();
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
    // origen y tokenAcceso no cambian mientras se muestra la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId, accessToken, consulta]);

  const esMesa = origen.tipo === 'mesa';

  return (
    <div className="pt-20 pb-12 px-4 md:px-8 max-w-[640px] mx-auto flex flex-col gap-6">
      <section className={`${CLASE_TARJETA} text-center flex flex-col items-center gap-2`}>
        <span className="grid place-items-center w-20 h-20 rounded-full bg-culinary-primary-container text-[#6e54ad] mb-2">
          <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m8 12 3 3 5-6" />
          </svg>
        </span>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#6e54ad]">Pago aprobado</p>
        <h1
          ref={tituloRef}
          tabIndex={-1}
          className="text-2xl md:text-3xl font-bold text-foreground tracking-tight outline-none"
        >
          ¡Tu pedido ya está en cocina!
        </h1>
        <p className="text-sm text-[#5a575e]">
          {esMesa ? 'Te lo llevamos a la mesa apenas esté listo.' : 'Te avisamos acá cuando esté listo para retirar.'}
        </p>

        <div className="mt-4 w-full rounded-[0.75rem] bg-culinary-primary-container px-4 py-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#5a575e]">
            {esMesa ? etiquetaMesa(numeroMesa) : 'Código de tu pedido'}
          </p>
          <p className="mt-1 text-4xl md:text-5xl font-bold tracking-tight text-[#6e54ad]">
            {codigoPedido(pedidoId)}
          </p>
          <p className="mt-1 text-sm text-[#5a575e]">
            {esMesa ? 'Si necesitás algo, mostrá este código al personal.' : 'Mostralo en el mostrador al retirar.'}
          </p>
        </div>
      </section>

      <section aria-labelledby="estado-pedido" className={CLASE_TARJETA}>
        <h2 id="estado-pedido" className="text-lg font-bold text-foreground">
          Estado de tu pedido
        </h2>
        <SeguimientoPedido pedidoId={pedidoId} token={accessToken} estadoInicial="RECIBIDO" />
      </section>

      <Comprobante
        comprobante={comprobante}
        agotado={agotado}
        onReintentar={() => setConsulta((n) => n + 1)}
      />

      <section aria-labelledby="resumen-pagado" className={CLASE_TARJETA}>
        <h2 id="resumen-pagado" className="text-lg font-bold text-foreground">
          Resumen del pedido
        </h2>
        <ul className="mt-3 divide-y divide-culinary-neutral/15 border-t border-culinary-neutral/15">
          {lineas.map((l) => (
            <li key={l.itemCartaId} className="py-3 flex items-start justify-between gap-3 text-sm">
              <span className="text-foreground">
                {l.cantidad}× {l.nombre}
              </span>
              <span className="text-foreground shrink-0">{formatearPrecio(l.precio * l.cantidad)}</span>
            </li>
          ))}
        </ul>
        <div className="pt-4 border-t border-culinary-neutral/15 flex items-center justify-between">
          <span className="font-bold text-foreground">Total abonado</span>
          <span className="text-2xl font-bold text-foreground">{formatearPrecio(total)}</span>
        </div>
      </section>

      <button
        type="button"
        onClick={onOtroPedido}
        className="self-center inline-flex items-center gap-2 px-5 py-2.5 text-[#6e54ad] font-semibold rounded-[0.5rem] hover:bg-[#6e54ad]/10 transition-colors"
      >
        Hacer otro pedido
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

function Comprobante({
  comprobante,
  agotado,
  onReintentar,
}: {
  readonly comprobante: EstadoComprobante;
  readonly agotado: boolean;
  readonly onReintentar: () => void;
}) {
  return (
    <section aria-labelledby="comprobante" aria-live="polite" className={CLASE_TARJETA}>
      <div className="flex items-start gap-4">
        <span className="shrink-0 grid place-items-center w-12 h-12 rounded-full bg-culinary-primary-container text-[#6e54ad]">
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
            <path d="M9 7h6" />
            <path d="M9 11h6" />
            <path d="M9 15h4" />
          </svg>
        </span>
        <div className="flex-1 min-w-0">
          <h2 id="comprobante" className="text-lg font-bold text-foreground">
            Comprobante fiscal
          </h2>

          <EstadoDelComprobante
            comprobante={comprobante}
            agotado={agotado}
            onReintentar={onReintentar}
          />
        </div>
      </div>
    </section>
  );
}

/** Emitido (con enlace a DGI), demorado (se puede volver a consultar) o emitiéndose. */
function EstadoDelComprobante({
  comprobante,
  agotado,
  onReintentar,
}: {
  readonly comprobante: EstadoComprobante;
  readonly agotado: boolean;
  readonly onReintentar: () => void;
}) {
  if (comprobante.tipo === 'emitido') {
    return (
      <>
        <p className="mt-1 text-sm text-[#5a575e]">
          <span className="font-semibold text-foreground">{comprobante.texto}</span> · emitido
        </p>
        {comprobante.urlConsulta && (
          <a
            href={comprobante.urlConsulta}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 bg-[#6e54ad] text-white font-semibold rounded-[0.5rem] hover:bg-[#5b468f] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30 transition-colors"
          >
            Ver comprobante en DGI
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
            <span className="sr-only">(se abre en otra pestaña)</span>
          </a>
        )}
      </>
    );
  }
  if (agotado) {
    return (
      <>
        <p className="mt-1 text-sm text-[#5a575e]">
          Tu pago está aprobado. El comprobante todavía se está emitiendo:
          volvé a consultar en unos minutos o pedíselo al personal del local.
        </p>
        <button
          type="button"
          onClick={onReintentar}
          className="mt-3 px-4 py-2 bg-[#6e54ad]/10 text-[#6e54ad] font-semibold rounded-[0.5rem] hover:bg-[#6e54ad] hover:text-white transition-colors"
        >
          Volver a consultar
        </button>
      </>
    );
  }
  return (
    <p className="mt-1 text-sm text-[#5a575e] flex items-center gap-2">
      <svg aria-hidden="true" className="animate-spin shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      Estamos emitiendo tu comprobante…
    </p>
  );
}
