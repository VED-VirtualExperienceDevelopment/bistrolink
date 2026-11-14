"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Pedido } from "@/types/pedido";
import { OrderTicket } from "./OrderTicket";
import { textoAltaDemanda, type EstadoCola } from "./cola-kds.utils";
import type { UmbralesEspera } from "./espera-kds.utils";
import {
  ANCHO_MINIMO_TARJETA,
  agruparPorMesa,
  comandasDelMonitor,
  comandasPorMesa,
  densidadMonitor,
  resumenMonitor,
  textoEnPreparacion,
  textoOcultas,
  type GrupoMesaMonitor,
  type ResumenMonitor,
} from "./monitor-cocina.utils";

interface MonitorCocinaProps {
  pedidos: Pedido[];
  cola: EstadoCola | null;
  ahora: number;
  umbrales: UmbralesEspera;
}

// Cocina no cambia estados (RD.06): las comandas no tienen botones.
const SIN_TRANSICIONES = () => undefined;

/**
 * Identifica una comanda y su estado. Si cambia alguna, el monitor vuelve a
 * medir cuántas tarjetas entran.
 */
const firmaDeComanda = (pedido: Pedido) => `${pedido.id}:${pedido.estado}`;

const CLASE_DATO =
  "flex items-baseline gap-2 rounded-xl bg-surface-container px-4 py-2 text-on-surface";

/** Un dato de la barra de resumen: etiqueta y número grande. */
function DatoResumen({
  testId,
  etiqueta,
  valor,
}: Readonly<{ testId: string; etiqueta: string; valor: string }>) {
  return (
    <li data-testid={testId} className={CLASE_DATO}>
      <span className="text-body-lg">{etiqueta}</span>
      <span className="text-headline-md font-bold">{valor}</span>
    </li>
  );
}

/**
 * Barra de resumen, grande para leerla a 2 metros: en preparación (con el
 * límite de la cola, si está activa), listos, en espera, la alerta de alta
 * demanda (HU-042) y las comandas que no entran en la pantalla.
 */
function ResumenCocina({
  resumen,
  cola,
  ocultas,
}: Readonly<{
  resumen: ResumenMonitor;
  cola: EstadoCola | null;
  ocultas: number;
}>) {
  return (
    <div aria-live="polite" className="shrink-0">
      <ul
        data-testid="monitor-resumen"
        aria-label="Resumen de la cocina"
        className="flex flex-wrap items-center gap-3"
      >
        <DatoResumen
          testId="monitor-en-preparacion"
          etiqueta="En preparación"
          valor={textoEnPreparacion(
            resumen.enPreparacion,
            cola?.limite ?? null,
          )}
        />
        <DatoResumen
          testId="monitor-listos"
          etiqueta="Listos"
          valor={String(resumen.listos)}
        />
        <DatoResumen
          testId="monitor-en-espera"
          etiqueta="En espera"
          valor={String(resumen.enEspera)}
        />
        {cola?.altaDemanda && (
          <li
            data-testid="cola-alta-demanda"
            className="flex items-center gap-2 rounded-xl bg-error-container px-4 py-2 text-headline-sm font-bold text-on-error-container"
          >
            <span aria-hidden="true">⚠</span>
            {textoAltaDemanda(cola)}
          </li>
        )}
        {ocultas > 0 && (
          <li
            data-testid="monitor-ocultas"
            className="rounded-xl bg-tertiary-container px-4 py-2 text-headline-sm font-bold text-on-tertiary-container"
          >
            {textoOcultas(ocultas)}
          </li>
        )}
      </ul>
    </div>
  );
}

interface PropsTarjetas {
  ahora: number;
  umbrales: UmbralesEspera;
  /** Ancho de cada tarjeta (px), según la densidad. */
  ancho: number;
}

/**
 * Las comandas de una mesa, juntas. Si la mesa tiene más de una, el bloque
 * lleva un título grande («Mesa 3 · 2 pedidos») y un fondo que las agrupa.
 * `total` cuenta también las que no entran en la pantalla.
 */
function GrupoMesa({
  grupo,
  total,
  tarjetas,
}: Readonly<{
  grupo: GrupoMesaMonitor;
  total: number;
  tarjetas: PropsTarjetas;
}>) {
  const varias = total > 1;
  const idTitulo = `monitor-mesa-${grupo.mesaNumero}`;
  return (
    <section
      data-testid="monitor-mesa"
      data-mesa={grupo.mesaNumero}
      aria-labelledby={varias ? idTitulo : undefined}
      className={
        varias
          ? "flex max-w-full flex-col gap-2 rounded-2xl bg-surface-container p-3"
          : "flex max-w-full flex-col"
      }
    >
      {varias && (
        <h2
          id={idTitulo}
          className="text-headline-sm font-bold text-on-surface"
        >
          {/* HU-040 (BL-210): los pedidos para retirar van todos juntos. */}
          {grupo.pedidos[0]?.retiro
            ? "Para retirar"
            : `Mesa ${grupo.mesaNumero}`}{" "}
          · {total} pedidos
        </h2>
      )}
      <ol className="flex flex-wrap items-start gap-gutter">
        {grupo.pedidos.map((pedido) => (
          <li
            key={pedido.id}
            className="max-w-full"
            style={{ width: tarjetas.ancho }}
          >
            <OrderTicket
              pedido={pedido}
              puedeOperarTransiciones={false}
              onTransicion={SIN_TRANSICIONES}
              ahora={tarjetas.ahora}
              umbrales={tarjetas.umbrales}
              variante="monitor"
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * HU-038 (BL-510): monitor de Cocina. Una tarjeta por pedido en preparación
 * o listo, agrupadas por mesa, en un área que entra en la pantalla sin
 * scroll:
 * - el ancho de las tarjetas depende de cuántas hay (densidadMonitor);
 * - cada tarjeta toma el alto de sus ítems (no se corta nada);
 * - si aun así no entran, se ocultan desde el final (las listas más nuevas
 *   primero) y la barra de resumen avisa «+N pedidos más».
 *
 * Para saber cuántas entran se mide la grilla antes de pintar
 * (useLayoutEffect): si se pasa de alto, se saca una tarjeta y se vuelve a
 * medir. Con cada cambio de comandas, de reloj o de tamaño de la pantalla se
 * vuelve a probar con todas.
 */
export function MonitorCocina({
  pedidos,
  cola,
  ahora,
  umbrales,
}: Readonly<MonitorCocinaProps>) {
  const comandas = comandasDelMonitor(pedidos);
  const densidad = densidadMonitor(comandas.length);
  const grillaRef = useRef<HTMLDivElement>(null);
  const [tamano, setTamano] = useState(0);
  const [ajuste, setAjuste] = useState({ clave: "", visibles: 0 });

  // Al cambiar el tamaño de la pantalla, se vuelve a medir.
  useEffect(() => {
    const grilla = grillaRef.current;
    if (!grilla || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => setTamano((t) => t + 1));
    observador.observe(grilla);
    return () => observador.disconnect();
  }, []);

  const firmaComandas = comandas.map(firmaDeComanda).join("|");
  const clave = `${firmaComandas}#${tamano}#${ahora}`;
  const visibles = ajuste.clave === clave ? ajuste.visibles : comandas.length;

  useLayoutEffect(() => {
    const grilla = grillaRef.current;
    // Siempre queda al menos una tarjeta a la vista.
    if (!grilla || visibles <= 1) return;
    if (grilla.scrollHeight > grilla.clientHeight + 1) {
      setAjuste({ clave, visibles: visibles - 1 });
    }
  }, [clave, visibles]);

  const mostradas = comandas.slice(0, visibles);
  const totalPorMesa = comandasPorMesa(comandas);
  const tarjetas: PropsTarjetas = {
    ahora,
    umbrales,
    ancho: ANCHO_MINIMO_TARJETA[densidad],
  };

  return (
    <div
      data-testid="monitor-cocina"
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <ResumenCocina
        resumen={resumenMonitor(pedidos)}
        cola={cola}
        ocultas={comandas.length - mostradas.length}
      />
      {comandas.length === 0 && (
        <p className="text-headline-sm text-on-surface-variant">
          No hay pedidos en preparación.
        </p>
      )}
      <div
        ref={grillaRef}
        data-testid="monitor-grilla"
        data-densidad={densidad}
        className="flex min-h-0 flex-1 flex-wrap content-start items-start gap-gutter overflow-hidden"
      >
        {agruparPorMesa(mostradas).map((grupo) => (
          <GrupoMesa
            key={grupo.mesaNumero}
            grupo={grupo}
            total={totalPorMesa.get(grupo.mesaNumero) ?? grupo.pedidos.length}
            tarjetas={tarjetas}
          />
        ))}
      </div>
    </div>
  );
}
