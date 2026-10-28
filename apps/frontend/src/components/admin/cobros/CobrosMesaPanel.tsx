"use client";

import { PedidosPorCobrar } from "./PedidosPorCobrar";
import { pendientesDeLaMesa } from "./cobros.utils";
import { usePendientesDeCobro } from "./usePendientesDeCobro";

interface Props {
  readonly mesaId: string;
  readonly numero: number;
  readonly token: string | undefined;
}

/**
 * HU-031 (BL-201): en el panel de la mesa seleccionada del mapa, los pedidos
 * de esa mesa que esperan el pago, para cobrarlos en efectivo. Lo ven el
 * mozo y el administrador.
 */
export function CobrosMesaPanel({ mesaId, numero, token }: Props) {
  const { datos, cargando, error, recargar } = usePendientesDeCobro(token);
  const pedidos = datos ? pendientesDeLaMesa(datos.pedidos, mesaId) : [];

  return (
    <section
      aria-label={`Pedidos de la mesa ${numero} pendientes de pago`}
      className="space-y-2 rounded-lg bg-surface-container-low px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-label-md text-on-surface">Pendientes de pago</h2>
        <button
          type="button"
          onClick={() => void recargar()}
          disabled={cargando}
          aria-busy={cargando}
          className="flex min-h-12 items-center gap-1 rounded-lg px-3 text-body-md text-primary hover:bg-surface-container disabled:opacity-50"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
            refresh
          </span>
          <span>Actualizar</span>
        </button>
      </div>

      {error && (
        <p role="alert" className="text-label-sm text-error">
          {error}
        </p>
      )}
      {datos && (
        <PedidosPorCobrar
          pedidos={pedidos}
          efectivoHabilitado={datos.efectivoHabilitado}
          token={token}
          vacio="No hay pedidos de esta mesa esperando el pago."
          onCobrado={() => void recargar()}
        />
      )}
    </section>
  );
}
