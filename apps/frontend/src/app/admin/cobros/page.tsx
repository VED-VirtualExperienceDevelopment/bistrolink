"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { PedidosPorCobrar } from "@/components/admin/cobros/PedidosPorCobrar";
import {
  PARAM_PEDIDO,
  RUTA_PANTALLA_COBROS,
  pendientesEnMesas,
  pendientesParaRetirar,
  resolverPedidoDestacado,
} from "@/components/admin/cobros/cobros.utils";
import { usePendientesDeCobro } from "@/components/admin/cobros/usePendientesDeCobro";

/**
 * HU-031 (BL-201): cobros pendientes (en efectivo y, HU-007b / BL-80, con
 * el POS del local). Los pedidos para retirar no tienen
 * mesa en el mapa: se cobran acá. También se listan los de las mesas, que
 * se pueden cobrar desde acá o desde el panel de la mesa.
 *
 * BL-470: «Ir a cobrar», en un aviso de efectivo de las alertas, llega con
 * `?pedido=<id>`. Cuando termina de cargar la lista, ese pedido se destaca
 * y se anuncia; si ya no está pendiente, se avisa y se limpia el parámetro.
 * `useSearchParams` va dentro de un <Suspense>: sin él, Next 15 no compila
 * la ruta estática.
 */
export default function CobrosPage() {
  return (
    <Suspense fallback={null}>
      <Cobros />
    </Suspense>
  );
}

function Cobros() {
  const { token } = useKeycloakAuth();
  const { datos, cargando, error, recargar } = usePendientesDeCobro(token);
  const router = useRouter();
  const pedidoParam = useSearchParams().get(PARAM_PEDIDO);
  const [destacadoId, setDestacadoId] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  // El parámetro se resuelve una sola vez por pedido: después de cobrarlo,
  // la lista se recarga sin él y no tiene que aparecer «ya no está pendiente».
  const resueltoRef = useRef<string | null>(null);

  useEffect(() => {
    if (!datos || cargando || !pedidoParam) return;
    if (resueltoRef.current === pedidoParam) return;
    resueltoRef.current = pedidoParam;
    const resultado = resolverPedidoDestacado(datos.pedidos, pedidoParam);
    if (resultado.tipo === "pendiente") {
      setDestacadoId(resultado.pedidoId);
      setAnuncio(resultado.anuncio);
    } else if (resultado.tipo === "no-pendiente") {
      setDestacadoId(null);
      setAnuncio(resultado.anuncio);
      router.replace(RUTA_PANTALLA_COBROS);
    }
  }, [datos, cargando, pedidoParam, router]);

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-lg text-primary">Cobros pendientes</h1>
          <p className="text-body-md text-on-surface-variant">
            Pedidos que esperan el pago. Al cobrar en efectivo o registrar el
            cobro hecho con el POS del local, el pedido pasa a cocina y se
            emite el comprobante.
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

      {/* BL-470: existe siempre, así el lector de pantalla anuncia el texto
          cuando aparece. <output> tiene el rol «status» implícito. */}
      <output
        className={
          anuncio
            ? "flex items-center gap-2 rounded-lg bg-secondary-container px-3 py-3 text-body-md text-on-secondary-container"
            : "sr-only"
        }
      >
        {anuncio && (
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
            info
          </span>
        )}
        <span>{anuncio}</span>
      </output>

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
              posHabilitado={datos.posHabilitado}
              token={token}
              vacio="No hay pedidos para retirar esperando el pago."
              onCobrado={() => void recargar()}
              destacadoId={destacadoId}
            />
          </section>
          <section aria-labelledby="cobros-mesas" className="space-y-3">
            <h2 id="cobros-mesas" className="text-headline-sm text-on-surface">
              En las mesas
            </h2>
            <PedidosPorCobrar
              pedidos={pendientesEnMesas(datos.pedidos)}
              efectivoHabilitado={datos.efectivoHabilitado}
              posHabilitado={datos.posHabilitado}
              token={token}
              conMesa
              vacio="No hay pedidos de mesas esperando el pago."
              onCobrado={() => void recargar()}
              destacadoId={destacadoId}
            />
          </section>
        </>
      )}
    </div>
  );
}
