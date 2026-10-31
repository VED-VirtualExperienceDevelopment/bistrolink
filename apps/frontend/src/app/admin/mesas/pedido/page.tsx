"use client";

import { Suspense, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { CobrarEfectivoDialog } from "@/components/admin/cobros/CobrarEfectivoDialog";
import {
  codigoDelPedido,
  formatearMonto,
  mensajeCobroRegistrado,
  type CobroEfectivoRegistrado,
} from "@/components/admin/cobros/cobros.utils";
import {
  armarPedido,
  cambiarCantidad,
  cambiarNota,
  cantidadDeItems,
  categoriasParaPedir,
  CANTIDAD_MAXIMA_POR_ITEM,
  LARGO_NOTA_GENERAL,
  LARGO_NOTA_ITEM,
  nuevaClaveDePedido,
  RUTA_CARTA_STAFF,
  RUTA_PEDIDO_MOZO,
  totalDelCarrito,
  type Carrito,
  type CategoriaCartaStaff,
  type ItemCartaStaff,
  type PedidoCargado,
} from "@/components/admin/pedido-mozo/pedido-mozo.utils";

const CLASE_BOTON_PRINCIPAL =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-body-md font-medium text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const CLASE_BOTON_SECUNDARIO =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg border border-outline-variant px-5 text-body-md text-on-surface hover:bg-surface-container";
const CLASE_STEPPER =
  "grid h-12 w-12 place-items-center rounded-full border border-outline-variant text-headline-sm text-primary hover:bg-surface-container disabled:opacity-40";

/**
 * HU-039 (BL-209): el mozo carga el pedido de un comensal sin celular en
 * una mesa abierta. Misma carta y mismas reglas que el comensal; el pedido
 * queda esperando el pago (prepago, RD.03) y el mozo lo cobra en efectivo
 * acá mismo o después, desde «Cobros pendientes». Pensada para usar con una
 * mano en el celular (RNF.01): botones de 48 px y el total fijo abajo.
 */
export default function CargarPedidoPage() {
  return (
    <Suspense fallback={null}>
      <CargarPedido />
    </Suspense>
  );
}

function CargarPedido() {
  const parametros = useSearchParams();
  const mesaId = parametros.get("mesa") ?? "";
  const numero = parametros.get("numero") ?? "";
  const { token } = useKeycloakAuth();

  const [categorias, setCategorias] = useState<CategoriaCartaStaff[] | null>(null);
  const [errorCarta, setErrorCarta] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<Carrito>({});
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargado, setCargado] = useState<PedidoCargado | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [cobro, setCobro] = useState<CobroEfectivoRegistrado | null>(null);
  // Una clave por carrito: si cambia el carrito, es otro pedido.
  const claveRef = useRef(nuevaClaveDePedido());
  const idNota = useId();

  useEffect(() => {
    if (!token) return;
    apiFetch<CategoriaCartaStaff[]>(RUTA_CARTA_STAFF, token)
      .then((datos) => setCategorias(categoriasParaPedir(datos ?? [])))
      .catch((e) =>
        setErrorCarta(
          e instanceof ApiError ? e.message : "No se pudo cargar la carta.",
        ),
      );
  }, [token]);

  function actualizar(nuevo: Carrito) {
    claveRef.current = nuevaClaveDePedido();
    setCarrito(nuevo);
    setError(null);
  }

  async function confirmar() {
    if (enviando || cantidadDeItems(carrito) === 0) return;
    setEnviando(true);
    setError(null);
    try {
      const pedido = await apiFetch<PedidoCargado>(RUTA_PEDIDO_MOZO, token, {
        method: "POST",
        body: JSON.stringify(armarPedido(mesaId, carrito, nota, claveRef.current)),
      });
      setCargado(pedido);
    } catch (e) {
      // 409 (mesa cerrada) y 400 (ítem no disponible) con el mensaje del backend.
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el pedido. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  function otroPedido() {
    claveRef.current = nuevaClaveDePedido();
    setCarrito({});
    setNota("");
    setCargado(null);
    setCobro(null);
  }

  if (!mesaId) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-body-md text-on-surface">
          Elegí una mesa en el mapa para cargar un pedido.
        </p>
        <Link href="/admin/mesas" className="mt-4 inline-flex text-primary underline">
          Ir al mapa de mesas
        </Link>
      </div>
    );
  }

  const titulo = numero ? `Pedido para la mesa ${numero}` : "Cargar pedido";

  if (cargado) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6">
        <h1 className="text-headline-lg text-primary">{titulo}</h1>
        <section className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
          {cobro ? (
            <output className="block text-body-lg text-on-surface">
              {mensajeCobroRegistrado(cobro)}
            </output>
          ) : (
            <>
              <output className="block text-body-lg text-on-surface">
                Pedido {codigoDelPedido(cargado.id)} cargado: {formatearMonto(cargado.total)}.
                Pasa a cocina cuando se cobra.
              </output>
              <button type="button" onClick={() => setCobrando(true)} className={CLASE_BOTON_PRINCIPAL}>
                <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
                  payments
                </span>
                <span>Cobrar en efectivo</span>
              </button>
              <p className="text-body-sm text-on-surface-variant">
                También lo podés cobrar después, desde «Cobros pendientes» o el panel de la mesa.
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={otroPedido} className={CLASE_BOTON_SECUNDARIO}>
              Cargar otro pedido
            </button>
            <Link href="/admin/mesas" className={CLASE_BOTON_SECUNDARIO}>
              Volver al mapa
            </Link>
          </div>
        </section>
        <CobrarEfectivoDialog
          pedido={cobrando ? cargado : null}
          token={token}
          onClose={() => setCobrando(false)}
          onCobrado={(registrado) => {
            setCobrando(false);
            setCobro(registrado);
          }}
        />
      </div>
    );
  }

  const cantidad = cantidadDeItems(carrito);
  const total = categorias ? totalDelCarrito(carrito, categorias) : "0";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 pb-0 md:p-6 md:pb-0">
      <div>
        <Link href="/admin/mesas" className="text-body-md text-primary hover:underline">
          ← Mapa de mesas
        </Link>
        <h1 className="mt-2 text-headline-lg text-primary">{titulo}</h1>
        <p className="text-body-md text-on-surface-variant">
          Para un comensal sin celular. El pedido pasa a cocina cuando se cobra.
        </p>
      </div>

      {errorCarta && (
        <p role="alert" className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {errorCarta}
        </p>
      )}

      {categorias?.map((categoria) => (
        <section key={categoria.id} aria-labelledby={`cat-${categoria.id}`} className="space-y-2">
          <h2 id={`cat-${categoria.id}`} className="text-headline-sm text-on-surface">
            {categoria.nombre}
          </h2>
          <ul className="space-y-2">
            {categoria.items.map((item) => (
              <FilaItem
                key={item.id}
                item={item}
                linea={carrito[item.id]}
                onCantidad={(delta) => actualizar(cambiarCantidad(carrito, item.id, delta))}
                onNota={(texto) => actualizar(cambiarNota(carrito, item.id, texto))}
              />
            ))}
          </ul>
        </section>
      ))}

      {categorias && (
        <div>
          <label htmlFor={idNota} className="mb-1 block text-label-md text-on-surface-variant">
            Nota para cocina (alergias, observaciones)
          </label>
          <textarea
            id={idNota}
            value={nota}
            maxLength={LARGO_NOTA_GENERAL}
            onChange={(e) => {
              claveRef.current = nuevaClaveDePedido();
              setNota(e.target.value);
            }}
            rows={2}
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      {/* Total y confirmación siempre a mano (RNF.01). Sticky dentro del
          contenido, para no tapar el menú lateral en la PC; en el celular
          deja lugar abajo para la etiqueta de la versión. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-outline-variant bg-surface px-4 pb-12 pt-3 shadow-lg md:-mx-6 md:px-6 md:pb-3">
        <div className="flex flex-col gap-2">
          {error && (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-body-md text-on-surface">
              <span>{cantidad} {cantidad === 1 ? "ítem" : "ítems"} · </span>
              <span className="font-medium">{formatearMonto(total)}</span>
            </p>
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={cantidad === 0 || enviando}
              aria-busy={enviando}
              className={CLASE_BOTON_PRINCIPAL}
            >
              {enviando ? "Cargando…" : "Confirmar pedido"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilaItem({
  item,
  linea,
  onCantidad,
  onNota,
}: {
  readonly item: ItemCartaStaff;
  readonly linea?: { cantidad: number; observacion: string };
  readonly onCantidad: (delta: number) => void;
  readonly onNota: (texto: string) => void;
}) {
  const idNota = useId();
  const cantidad = linea?.cantidad ?? 0;
  return (
    <li className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-md font-medium text-on-surface">{item.nombre}</p>
          <p className="text-body-sm text-on-surface-variant">
            {item.disponible ? formatearMonto(item.precio) : "No disponible"}
          </p>
        </div>
        {item.disponible && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onCantidad(-1)}
              disabled={cantidad === 0}
              aria-label={`Quitar una unidad de ${item.nombre}`}
              className={CLASE_STEPPER}
            >
              −
            </button>
            <output aria-live="polite" className="w-8 text-center text-body-lg text-on-surface">
              {cantidad}
            </output>
            <button
              type="button"
              onClick={() => onCantidad(1)}
              disabled={cantidad >= CANTIDAD_MAXIMA_POR_ITEM}
              aria-label={`Agregar una unidad de ${item.nombre}`}
              className={CLASE_STEPPER}
            >
              +
            </button>
          </div>
        )}
      </div>
      {cantidad > 0 && (
        <div className="mt-2">
          <label htmlFor={idNota} className="sr-only">
            Nota para {item.nombre}
          </label>
          <input
            id={idNota}
            type="text"
            value={linea?.observacion ?? ""}
            maxLength={LARGO_NOTA_ITEM}
            onChange={(e) => onNota(e.target.value)}
            placeholder="Nota (por ejemplo, sin sal)"
            className="min-h-12 w-full rounded-lg border border-outline-variant bg-surface px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}
    </li>
  );
}
