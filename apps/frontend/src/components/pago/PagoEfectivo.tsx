'use client';

import { useId, useState } from 'react';
import {
  evaluarPagaCon,
  formatearPrecio,
  mensajeEsperandoMozo,
  type MetodoPago,
} from './pago.utils';

// HU-031b (BL-442): pago en efectivo en la pantalla del comensal (solo
// pedidos de mesa, dentro del local).

const CLASE_TARJETA =
  'bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]';
const CLASE_INPUT =
  'w-full h-12 px-4 rounded-[0.75rem] text-base outline-none transition-all duration-200 placeholder:text-culinary-neutral bg-culinary-background border-2';
const CLASE_BOTON_PRINCIPAL =
  'w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-[#6e54ad] text-white font-bold rounded-[0.75rem] hover:bg-[#5b468f] focus:outline-none focus:ring-4 focus:ring-[#6e54ad]/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed text-lg';
const CLASE_BOTON_SECUNDARIO =
  'px-5 py-2.5 bg-[#6e54ad]/10 text-[#6e54ad] font-semibold rounded-[0.5rem] hover:bg-[#6e54ad] hover:text-white transition-colors disabled:opacity-50';

const OPCIONES: ReadonlyArray<{
  valor: MetodoPago;
  titulo: string;
  detalle: string;
}> = [
  {
    valor: 'tarjeta',
    titulo: 'Tarjeta de débito o crédito',
    detalle: 'Pagás desde acá y tu pedido pasa a cocina al instante.',
  },
  {
    valor: 'efectivo',
    titulo: 'Efectivo',
    detalle: 'Avisamos al mozo para que venga a cobrarte en la mesa.',
  },
];

/** «¿Cómo querés pagar?»: botones de opción nativos (teclado y lector de pantalla). */
export function SelectorMetodoPago({
  metodo,
  onCambiar,
  deshabilitado,
}: {
  readonly metodo: MetodoPago;
  readonly onCambiar: (metodo: MetodoPago) => void;
  readonly deshabilitado: boolean;
}) {
  const nombre = useId();
  return (
    <fieldset className={CLASE_TARJETA} disabled={deshabilitado}>
      <legend className="sr-only">¿Cómo querés pagar?</legend>
      <p aria-hidden="true" className="text-lg font-bold text-foreground mb-4">
        ¿Cómo querés pagar?
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPCIONES.map((opcion) => {
          const elegida = metodo === opcion.valor;
          const idOpcion = `${nombre}-${opcion.valor}`;
          return (
            <label
              key={opcion.valor}
              htmlFor={idOpcion}
              className={`grid cursor-pointer grid-cols-[auto_1fr] items-start gap-x-3 rounded-[0.75rem] border-2 p-4 transition-colors ${
                elegida
                  ? 'border-[#6e54ad] bg-[#6e54ad]/5'
                  : 'border-culinary-neutral/30 hover:border-[#6e54ad]/50'
              }`}
            >
              <input
                id={idOpcion}
                type="radio"
                name={nombre}
                value={opcion.valor}
                checked={elegida}
                onChange={() => onCambiar(opcion.valor)}
                className="row-span-2 mt-1 h-5 w-5 shrink-0 accent-[#6e54ad]"
              />
              {/* Texto directo en el label (sin anidar): Sonar S6853 lo
                  busca a poca profundidad. */}
              <span className="font-semibold text-foreground">{opcion.titulo}</span>
              <span className="text-sm text-[#5a575e]">{opcion.detalle}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Efectivo elegido: «¿Con cuánto vas a pagar?» (opcional) y «Avisar al mozo». */
export function FormularioEfectivo({
  total,
  enviando,
  error,
  onAvisar,
}: {
  readonly total: number;
  readonly enviando: boolean;
  readonly error: string | null;
  readonly onAvisar: (pagaCon: string | null) => void;
}) {
  const [texto, setTexto] = useState('');
  const [intentado, setIntentado] = useState(false);
  const idCampo = useId();
  const idAyuda = useId();
  const estado = evaluarPagaCon(texto, total);
  const invalido =
    intentado && (estado.tipo === 'invalido' || estado.tipo === 'insuficiente');

  let ayuda = 'Opcional: así el mozo trae el cambio justo.';
  if (invalido && estado.tipo === 'invalido') {
    ayuda = 'Ingresá un monto válido, por ejemplo 1000.';
  } else if (invalido) {
    ayuda = `El monto no puede ser menor que el total (${formatearPrecio(total)}).`;
  }

  return (
    <section aria-labelledby="pago-efectivo" className={CLASE_TARJETA}>
      <h2 id="pago-efectivo" className="text-lg font-bold text-foreground mb-1">
        Pagar en efectivo
      </h2>
      <p className="text-sm text-[#5a575e] mb-5">
        Total a pagar: <span className="font-semibold text-foreground">{formatearPrecio(total)}</span>.
        Tu pedido pasa a cocina cuando el mozo registre el cobro.
      </p>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setIntentado(true);
          if (estado.tipo === 'invalido' || estado.tipo === 'insuficiente') return;
          onAvisar(estado.tipo === 'ok' ? estado.monto : null);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idCampo} className="text-sm font-medium text-foreground">
            ¿Con cuánto vas a pagar?
          </label>
          <input
            id={idCampo}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={`Por ejemplo, ${Math.ceil(total / 100) * 100 + 100}`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-invalid={invalido}
            aria-describedby={idAyuda}
            className={`${CLASE_INPUT} ${
              invalido
                ? 'border-[#BA1A1A] bg-[#FFDAD6]/40'
                : 'border-culinary-neutral/30 focus:border-[#6e54ad] focus:ring-2 focus:ring-[#6e54ad]/20'
            }`}
          />
          <p
            id={idAyuda}
            className={`text-xs ${invalido ? 'font-semibold text-[#BA1A1A]' : 'text-[#5a575e]'}`}
          >
            {ayuda}
          </p>
        </div>

        {error && (
          <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-700 text-sm font-medium">
            {error}
          </p>
        )}

        <button type="submit" disabled={enviando} aria-busy={enviando} className={CLASE_BOTON_PRINCIPAL}>
          {enviando ? 'Avisando…' : 'Avisar al mozo'}
        </button>
      </form>
    </section>
  );
}

/** Ya avisó: espera a que el mozo registre el cobro. */
export function EsperandoMozo({
  total,
  pagaCon,
  aviso,
  agotado,
  enviando,
  onAvisarDeNuevo,
  onConsultar,
  onPagarConTarjeta,
}: {
  readonly total: number;
  readonly pagaCon: string | null;
  readonly aviso: string | null;
  readonly agotado: boolean;
  readonly enviando: boolean;
  readonly onAvisarDeNuevo: () => void;
  readonly onConsultar: () => void;
  readonly onPagarConTarjeta: () => void;
}) {
  return (
    <section
      aria-live="polite"
      className={`${CLASE_TARJETA} flex flex-col items-center text-center gap-4`}
    >
      <span className="grid place-items-center w-16 h-16 rounded-full bg-culinary-primary-container text-[#6e54ad]">
        <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={agotado ? '' : 'animate-pulse'}>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6 12h.01M18 12h.01" />
        </svg>
      </span>
      <p className="text-base font-semibold text-foreground max-w-sm">
        {mensajeEsperandoMozo(total, pagaCon)}
      </p>
      <p className="text-sm text-[#5a575e] max-w-sm">
        {agotado
          ? 'Todavía no se registró el cobro. Si el mozo ya te cobró, consultá de nuevo.'
          : 'Esta pantalla se actualiza sola cuando el mozo registra el cobro.'}
      </p>
      {aviso && <p className="text-sm font-medium text-[#1e8e3e]">{aviso}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        {agotado && (
          <button type="button" onClick={onConsultar} className={CLASE_BOTON_SECUNDARIO}>
            Volver a consultar
          </button>
        )}
        <button
          type="button"
          onClick={onAvisarDeNuevo}
          disabled={enviando}
          aria-busy={enviando}
          className={CLASE_BOTON_SECUNDARIO}
        >
          {enviando ? 'Avisando…' : 'Volver a avisar al mozo'}
        </button>
        <button
          type="button"
          onClick={onPagarConTarjeta}
          className="px-5 py-2.5 text-[#6e54ad] font-semibold underline-offset-4 hover:underline"
        >
          Prefiero pagar con tarjeta
        </button>
      </div>
    </section>
  );
}
