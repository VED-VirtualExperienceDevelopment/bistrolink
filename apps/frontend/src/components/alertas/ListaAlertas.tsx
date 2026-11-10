'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LlamadoMozo } from '@/components/kds/llamado.utils';
import { rutaCobrarPedido } from '@/components/admin/cobros/cobros.utils';
import {
  CLASE_ESTADO_STOCK,
  ETIQUETA_TIPO,
  textoSinStock,
  textoUnidades,
  type AlertaStock,
} from '@/components/admin/stock/stock.utils';
import { useAlertas, type AccionLlamado } from './AlertasProvider';
import {
  detalleEfectivo,
  esDemorada,
  tiempoTranscurrido,
  tituloAlerta,
} from './alertas.utils';

// Cada cuánto se actualiza el «hace X min» mientras la lista está a la vista.
const REFRESCO_TIEMPO_MS = 15_000;
const RUTA_STOCK = '/admin/stock';

const CLASE_FOCO =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const CLASE_BOTON_PRIMARIO = `min-h-10 flex-1 rounded-lg bg-primary px-3 text-label-md text-on-primary hover:opacity-90 touch:min-h-12 ${CLASE_FOCO}`;
const CLASE_BOTON_SECUNDARIO = `min-h-10 flex-1 rounded-lg border border-outline px-3 text-label-md text-on-surface-variant hover:bg-surface-container-high touch:min-h-12 ${CLASE_FOCO}`;
const CLASE_TITULO_SECCION =
  'flex items-center gap-2 px-1 py-2 text-label-md text-on-surface-variant';
const CLASE_AVISO =
  'rounded-lg bg-tertiary-container px-3 py-2 text-label-md text-on-tertiary-container';

/** Sin alertas y con conexión: no hay nada que atender. */
function EstadoVacio() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant"
      >
        <span className="material-symbols-outlined text-[32px]">done_all</span>
      </span>
      <p className="text-body-md font-semibold text-on-surface">
        No hay alertas pendientes.
      </p>
      <p className="max-w-xs text-body-sm text-on-surface-variant">
        Cuando una mesa llame al mozo, pida pagar en efectivo o un ítem se
        agote, lo vas a ver acá. Se actualiza sola.
      </p>
    </div>
  );
}

/**
 * Sin alertas y sin conexión: no se sabe si hay algo pendiente. Decir «no hay
 * alertas» sería dar una tranquilidad que no se puede asegurar.
 */
function EstadoSinConexion() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-tertiary-container text-on-tertiary-container"
      >
        <span className="material-symbols-outlined text-[32px]">sync</span>
      </span>
      <p className="text-body-md font-semibold text-on-surface">
        Conectando con el servidor…
      </p>
      <p className="max-w-xs text-body-sm text-on-surface-variant">
        Todavía no sabemos si hay alertas pendientes. Se muestran apenas se
        conecte.
      </p>
    </div>
  );
}

/**
 * Un llamado de mesa o un aviso de pago en efectivo.
 *
 * BL-470: en el aviso de efectivo, «Aceptar» pasa a ser «Ir a cobrar»: marca
 * el aviso como atendido (igual que «Aceptar») y lleva a Cobros pendientes
 * con el pedido destacado. Sin pedido en el aviso, va a la lista completa.
 */
function TarjetaLlamado({
  llamado,
  ahora,
  puedeResolver,
  resolver,
  onNavegar,
}: Readonly<{
  llamado: LlamadoMozo;
  ahora: number;
  puedeResolver: boolean;
  resolver: (mesaId: string, accion: AccionLlamado) => void;
  onNavegar: (ruta: string) => void;
}>) {
  const efectivo = llamado.motivo === 'PAGO_EFECTIVO';
  const detalle = detalleEfectivo(llamado);
  const demorada = esDemorada(llamado.ts, ahora);
  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border bg-surface-container-low p-3 ${
        demorada ? 'border-error' : 'border-outline-variant'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            efectivo
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-tertiary-container text-on-tertiary-container'
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">
            {efectivo ? 'payments' : 'notifications_active'}
          </span>
        </span>
        <div className="min-w-0">
          <p className="text-body-md font-semibold text-on-surface">
            {tituloAlerta(llamado)}
          </p>
          {detalle && (
            <p className="text-body-md tabular-nums text-on-surface">
              {detalle}
            </p>
          )}
          <p
            className={`flex items-center gap-1 text-body-sm ${
              demorada ? 'font-semibold text-error' : 'text-on-surface-variant'
            }`}
          >
            {demorada && (
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[16px]"
              >
                schedule
              </span>
            )}
            <span>{tiempoTranscurrido(llamado.ts, ahora)}</span>
            {demorada && <span className="sr-only">, demorada</span>}
          </p>
        </div>
      </div>
      {puedeResolver && (
        <div className="flex gap-2">
          {efectivo ? (
            <button
              type="button"
              onClick={() => {
                resolver(llamado.mesaId, 'aceptado');
                onNavegar(rutaCobrarPedido(llamado.pedidoId));
              }}
              aria-label={`Ir a cobrar la mesa ${llamado.mesaNumero}`}
              className={`flex items-center justify-center gap-1.5 ${CLASE_BOTON_PRIMARIO}`}
            >
              <span>Ir a cobrar</span>
              <span
                aria-hidden="true"
                className="material-symbols-outlined text-[18px]"
              >
                arrow_forward
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => resolver(llamado.mesaId, 'aceptado')}
              aria-label={`Aceptar la alerta de la mesa ${llamado.mesaNumero}`}
              className={CLASE_BOTON_PRIMARIO}
            >
              Aceptar
            </button>
          )}
          <button
            type="button"
            onClick={() => resolver(llamado.mesaId, 'desestimado')}
            aria-label={`Desestimar la alerta de la mesa ${llamado.mesaNumero}`}
            className={CLASE_BOTON_SECUNDARIO}
          >
            Desestimar
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * BL-470: un ítem agotado o por agotarse. Sin «Desestimar»: la alerta se va
 * sola cuando el ítem vuelve a tener unidades.
 */
function TarjetaStock({
  alerta,
  sinStock,
  onReponer,
}: Readonly<{
  alerta: AlertaStock;
  sinStock: number;
  onReponer: (alerta: AlertaStock) => void;
}>) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-md font-semibold text-on-surface">
            {alerta.nombre}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            {textoUnidades(alerta)}
          </p>
          {sinStock > 0 && (
            <p className="text-body-sm font-semibold text-error">
              {textoSinStock(sinStock)}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-label-sm ${CLASE_ESTADO_STOCK[alerta.tipo]}`}
        >
          {ETIQUETA_TIPO[alerta.tipo]}
        </span>
      </div>
      <div className="flex">
        <button
          type="button"
          onClick={() => onReponer(alerta)}
          aria-label={`Reponer stock de ${alerta.nombre}`}
          className={`min-h-10 rounded-lg border border-primary px-4 text-label-md text-primary hover:bg-surface-container-high touch:min-h-12 ${CLASE_FOCO}`}
        >
          Reponer stock
        </button>
      </div>
    </li>
  );
}

/**
 * BL-441: lista de alertas pendientes (llamados de mesa y avisos de pago en
 * efectivo). La comparten la vista rápida de la campana y la pantalla Alertas.
 *
 * BL-470: para el Administrador agrupa en dos secciones, Salón y Stock, cada
 * una con su cantidad. El Mozo ve solo las del salón, sin títulos. La región
 * aria-live pasó a la campana (CampanaAlertas), que está siempre montada:
 * acá solo existía con la vista rápida abierta o en la pantalla Alertas.
 */
export function ListaAlertas() {
  const alertas = useAlertas();
  const router = useRouter();
  const [ahora, setAhora] = useState(() => Date.now());
  // La lista puede estar dos veces en pantalla (la pantalla Alertas y la
  // vista rápida): los ids de los títulos no se pueden repetir.
  const id = useId();
  const idSalon = `${id}-salon`;
  const idStock = `${id}-stock`;

  useEffect(() => {
    const intervalo = setInterval(
      () => setAhora(Date.now()),
      REFRESCO_TIEMPO_MS,
    );
    return () => clearInterval(intervalo);
  }, []);

  if (!alertas) return null;
  const {
    llamados,
    alertasStock,
    sinStock,
    errorStock,
    veStock,
    puedeResolver,
    resolver,
    conectado,
    abrirReponer,
    cerrarPanel,
  } = alertas;

  const listaSalon = (
    <ul className="flex flex-col gap-2">
      {llamados.map((llamado) => (
        <TarjetaLlamado
          key={llamado.mesaId}
          llamado={llamado}
          ahora={ahora}
          puedeResolver={puedeResolver}
          resolver={resolver}
          onNavegar={(ruta) => {
            cerrarPanel();
            router.push(ruta);
          }}
        />
      ))}
    </ul>
  );

  // Con alertas en pantalla y sin conexión, pueden estar desactualizadas.
  const avisoSinConexion = !conectado && llamados.length > 0 && (
    <p className={`mb-2 ${CLASE_AVISO}`}>
      Sin conexión con el servidor. Reconectando… Las alertas pueden no estar
      al día.
    </p>
  );

  // Mozo: una sola lista, como antes de BL-470.
  if (!veStock) {
    if (llamados.length === 0) {
      return conectado ? <EstadoVacio /> : <EstadoSinConexion />;
    }
    return (
      <div className="max-w-2xl">
        {avisoSinConexion}
        {listaSalon}
      </div>
    );
  }

  // Administrador sin nada en ninguna sección: un solo estado vacío.
  if (llamados.length === 0 && alertasStock.length === 0 && !errorStock) {
    return conectado ? <EstadoVacio /> : <EstadoSinConexion />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <section aria-labelledby={idSalon}>
        <h3 id={idSalon} className={CLASE_TITULO_SECCION}>
          <span>SALÓN</span>
          <span className="sr-only">,</span>
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-secondary-container px-1.5 text-label-sm tabular-nums text-on-secondary-container">
            {llamados.length}
          </span>
        </h3>
        {avisoSinConexion}
        {llamados.length > 0 && listaSalon}
        {llamados.length === 0 && (
          <p className="px-1 pb-2 text-body-sm text-on-surface-variant">
            {conectado
              ? 'Sin alertas del salón.'
              : 'Conectando con el servidor… Todavía no sabemos si hay alertas del salón.'}
          </p>
        )}
      </section>

      <section aria-labelledby={idStock}>
        <h3 id={idStock} className={CLASE_TITULO_SECCION}>
          <span>STOCK</span>
          <span className="sr-only">,</span>
          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-secondary-container px-1.5 text-label-sm tabular-nums text-on-secondary-container">
            {alertasStock.length}
          </span>
        </h3>
        {errorStock && (
          <p role="status" className={`mb-2 ${CLASE_AVISO}`}>
            No se pudieron cargar las alertas de stock. Se vuelve a intentar al
            reconectar.
          </p>
        )}
        {alertasStock.length > 0 && (
          <ul className="flex flex-col gap-2">
            {alertasStock.map((alerta) => (
              <TarjetaStock
                key={alerta.itemId}
                alerta={alerta}
                sinStock={sinStock[alerta.itemId] ?? 0}
                onReponer={abrirReponer}
              />
            ))}
          </ul>
        )}
        {alertasStock.length === 0 && !errorStock && (
          <p className="px-1 pb-2 text-body-sm text-on-surface-variant">
            Sin ítems por agotarse.
          </p>
        )}
        <Link
          href={RUTA_STOCK}
          onClick={cerrarPanel}
          className={`flex min-h-12 items-center rounded-lg px-1 text-body-md text-primary hover:underline ${CLASE_FOCO}`}
        >
          Ver el stock de la jornada
        </Link>
      </section>
    </div>
  );
}
