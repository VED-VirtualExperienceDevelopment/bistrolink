"use client";

import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { PedidosPorCobrar } from "@/components/admin/cobros/PedidosPorCobrar";
import {
  pendientesEnMesas,
  pendientesParaRetirar,
} from "@/components/admin/cobros/cobros.utils";
import { usePendientesDeCobro } from "@/components/admin/cobros/usePendientesDeCobro";

/**
 * HU-031 (BL-201): cobros pendientes. Los pedidos para retirar no tienen
 * mesa en el mapa: se cobran acá. También se listan los de las mesas, que
 * se pueden cobrar desde acá o desde el panel de la mesa.
 */
export default function CobrosPage() {
  const { token } = useKeycloakAuth();
  const { datos, cargando, error, recargar } = usePendientesDeCobro(token);

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-primary">Cobros pendientes</h1>
          <p className="text-body-md text-on-surface-variant">
            Pedidos que esperan el pago. Al cobrar en efectivo, el pedido pasa
            a cocina y se emite el comprobante.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void recargar()}
          disabled={cargando}
          aria-busy={cargando}
          className="flex min-h-12 items-center gap-2 rounded-lg px-4 text-body-md font-medium text-primary hover:bg-surface-container disabled:opacity-50"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
            refresh
          </span>
          <span>Actualizar</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {error}
        </div>
      )}

      {datos && !datos.efectivoHabilitado && (
        <p className="rounded-xl bg-surface-container px-4 py-3 text-body-md text-on-surface">
          El cobro en efectivo no está habilitado en este establecimiento.
        </p>
      )}

      {datos && (
        <>
          <section aria-labelledby="cobros-retiro" className="space-y-3">
            <h2 id="cobros-retiro" className="text-headline-sm text-on-surface">
              Para retirar
            </h2>
            <PedidosPorCobrar
              pedidos={pendientesParaRetirar(datos.pedidos)}
              efectivoHabilitado={datos.efectivoHabilitado}
              token={token}
              vacio="No hay pedidos para retirar esperando el pago."
              onCobrado={() => void recargar()}
            />
          </section>
          <section aria-labelledby="cobros-mesas" className="space-y-3">
            <h2 id="cobros-mesas" className="text-headline-sm text-on-surface">
              En las mesas
            </h2>
            <PedidosPorCobrar
              pedidos={pendientesEnMesas(datos.pedidos)}
              efectivoHabilitado={datos.efectivoHabilitado}
              token={token}
              conMesa
              vacio="No hay pedidos de mesas esperando el pago."
              onCobrado={() => void recargar()}
            />
          </section>
        </>
      )}
    </div>
  );
}
