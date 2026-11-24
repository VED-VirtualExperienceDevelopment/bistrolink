"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useAlertas } from "@/components/alertas/AlertasProvider";
import { usePendientesDeCobro } from "@/components/admin/cobros/usePendientesDeCobro";
import VentasPorHora from "@/components/admin/reportes/VentasPorHora";
import { useReportes } from "@/components/admin/reportes/useReportes";
import {
  filtrosIniciales,
  formatearMonto,
  variacion,
  type PlatoVendido,
  type ReporteVentas,
} from "@/components/admin/reportes/reportes.utils";
import { CLASE_FOCO } from "@/components/admin/reportes/reportes.estilos";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { useReloj } from "@/components/kds/useReloj";
import { EncabezadoInicio } from "./EncabezadoInicio";
import {
  contar,
  mesasConGente,
  pedidosEnCocina,
  resumenSalon,
  topPlatos,
  type ResumenSalon,
} from "./inicio.utils";
import {
  FilaEnlace,
  Icono,
  Insignia,
  SinPendientes,
  TarjetaInicio,
  type TonoInsignia,
} from "./TarjetaInicio";
import {
  useMesasEnVivo,
  usePedidosEnVivo,
  useRefrescoEnVivo,
  useRestaurante,
} from "./useInicio";

const RELOJ_MS = 30_000;

const CLASE_KPI =
  "flex flex-col gap-1 rounded-xl border border-outline-variant bg-surface-container-lowest p-4";

const ACCESOS: readonly { href: string; texto: string; icono: string }[] = [
  { href: "/admin/mesas", texto: "Mapa de mesas", icono: "table_restaurant" },
  { href: "/admin/kds", texto: "KDS", icono: "skillet" },
  { href: "/admin/pos", texto: "POS del local", icono: "point_of_sale" },
  { href: "/admin/menu", texto: "Gestión de carta", icono: "restaurant_menu" },
];

function Kpi({
  titulo,
  valor,
  children,
}: Readonly<{ titulo: string; valor: ReactNode; children?: ReactNode }>) {
  return (
    <li className={CLASE_KPI}>
      <h2 className="text-label-md text-on-surface-variant">{titulo}</h2>
      <p className="text-headline-md text-on-surface">{valor}</p>
      {children}
    </li>
  );
}

function Comparacion({
  actual,
  anterior,
}: Readonly<{ actual: number; anterior: number }>) {
  const { sentido, texto } = variacion(actual, anterior, "HOY");
  const estilos = {
    sube: { clase: "text-green-700", icono: "trending_up" },
    baja: { clase: "text-error", icono: "trending_down" },
    igual: { clase: "text-on-surface-variant", icono: "trending_flat" },
  }[sentido];
  return (
    <p className={`flex items-center gap-1 text-body-sm ${estilos.clase}`}>
      <Icono nombre={estilos.icono} className="text-[16px]" />
      {texto}
    </p>
  );
}

function Pendiente({
  href,
  cantidad,
  singular,
  plural,
  tono,
}: Readonly<{
  href: string;
  cantidad: number;
  singular: string;
  plural: string;
  tono: TonoInsignia;
}>) {
  return (
    <FilaEnlace href={href}>
      <Insignia tono={cantidad > 0 ? tono : "neutro"}>{cantidad}</Insignia>
      <span className="flex-1">{cantidad === 1 ? singular : plural}</span>
    </FilaEnlace>
  );
}

function ResumenDelDia({
  reporte,
  error,
  salon,
  conMesas,
  enCocina,
}: Readonly<{
  reporte: ReporteVentas | null;
  error: string | null;
  salon: ResumenSalon;
  conMesas: boolean;
  enCocina: number;
}>) {
  const resumen = reporte?.resumen ?? null;
  const conVentas = resumen !== null && resumen.pedidos > 0;
  const textoCocina =
    enCocina > 0
      ? `${contar(enCocina, "pedido", "pedidos")} en la cocina`
      : "Ninguno en la cocina ahora";
  return (
    <section aria-label="Resumen del día">
      {error && (
        <p className="mb-3 rounded-lg bg-error-container/60 p-3 text-body-sm text-on-error-container">
          {error}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          titulo="Ventas de hoy"
          valor={resumen ? formatearMonto(resumen.totalVendido) : "—"}
        >
          {conVentas && (
            <Comparacion
              actual={resumen.totalVendido}
              anterior={resumen.anterior.totalVendido}
            />
          )}
          {resumen && !conVentas && (
            <p className="text-body-sm text-on-surface-variant">
              Todavía no se cobró ningún pedido hoy.
            </p>
          )}
        </Kpi>
        <Kpi titulo="Pedidos pagados" valor={resumen ? resumen.pedidos : "—"}>
          <p className="text-body-sm text-on-surface-variant">{textoCocina}</p>
        </Kpi>
        <Kpi
          titulo="Ticket promedio"
          valor={conVentas ? formatearMonto(resumen.ticketPromedio) : "—"}
        >
          {conVentas && (
            <p className="text-body-sm text-on-surface-variant">
              Propinas: {formatearMonto(resumen.propinas.total)}
            </p>
          )}
        </Kpi>
        <Kpi
          titulo="Mesas con gente"
          valor={conMesas ? `${mesasConGente(salon)} de ${salon.total}` : "—"}
        >
          {salon.paraLimpiar > 0 && (
            <p className="text-body-sm text-amber-800">
              {contar(salon.paraLimpiar, "mesa", "mesas")} para limpiar
            </p>
          )}
        </Kpi>
      </ul>
    </section>
  );
}

function TarjetaAtencion({
  llamados,
  porCobrar,
  stockBajo,
  cargando,
}: Readonly<{
  llamados: number;
  porCobrar: number;
  stockBajo: number;
  cargando: boolean;
}>) {
  const nadaPendiente = llamados === 0 && stockBajo === 0 && porCobrar === 0;
  return (
    <TarjetaInicio
      id="inicio-atencion"
      titulo="Necesita tu atención"
      icono="priority_high"
      cargando={cargando}
    >
      {nadaPendiente ? (
        <SinPendientes>Todo en orden: no hay nada pendiente.</SinPendientes>
      ) : (
        <ul className="-mx-2">
          <Pendiente
            href="/admin/alertas"
            cantidad={llamados}
            singular="alerta del salón sin atender"
            plural="alertas del salón sin atender"
            tono="peligro"
          />
          <Pendiente
            href="/admin/cobros"
            cantidad={porCobrar}
            singular="cobro pendiente"
            plural="cobros pendientes"
            tono="aviso"
          />
          <Pendiente
            href="/admin/stock"
            cantidad={stockBajo}
            singular="insumo con stock bajo"
            plural="insumos con stock bajo"
            tono="aviso"
          />
        </ul>
      )}
    </TarjetaInicio>
  );
}

function TarjetaMasPedido({
  platos,
  cargando,
  error,
  onReintentar,
}: Readonly<{
  platos: PlatoVendido[];
  cargando: boolean;
  error: string | null;
  onReintentar: () => void;
}>) {
  return (
    <TarjetaInicio
      id="inicio-mas-pedido"
      titulo="Lo más pedido hoy"
      icono="local_fire_department"
      cargando={cargando}
      error={error ? "No se pudieron cargar los platos." : null}
      onReintentar={onReintentar}
      enlace={{ href: "/admin/reportes", texto: "Ver reportes" }}
    >
      {platos.length > 0 ? (
        <ol className="space-y-2">
          {platos.map((plato, i) => (
            <li key={plato.itemCartaId} className="flex items-center gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-secondary-container text-label-md text-on-secondary-container">
                {i + 1}
              </span>
              <span className="flex-1 text-body-md text-on-surface">
                {plato.nombre}
              </span>
              <span className="text-body-md font-semibold text-on-surface">
                {plato.cantidad}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body-sm text-on-surface-variant">
          Cuando se cobre el primer pedido del día, acá vas a ver los platos que
          más salen.
        </p>
      )}
    </TarjetaInicio>
  );
}

function AccesosRapidos() {
  return (
    <nav aria-labelledby="inicio-accesos">
      <h2
        id="inicio-accesos"
        className="mb-3 text-body-lg font-semibold text-on-surface"
      >
        Accesos rápidos
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {ACCESOS.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className={`flex min-h-12 items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-body-md font-semibold text-on-surface transition-colors hover:border-primary hover:bg-secondary-container ${CLASE_FOCO}`}
            >
              <Icono nombre={a.icono} className="text-primary" />
              {a.texto}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * BL-520: Inicio del administrador. Cómo viene el día (ventas, pedidos,
 * ticket promedio y mesas), lo que necesita atención y accesos rápidos. Los
 * números de ventas son los mismos de Reportes (período «Hoy»).
 */
export function InicioAdmin() {
  const ahora = useReloj(RELOJ_MS);
  const { token } = useKeycloakAuth();
  const alertas = useAlertas();
  const restaurante = useRestaurante();
  const [filtros] = useState(() => filtrosIniciales());
  const ventas = useReportes(filtros);
  const { pedidos } = usePedidosEnVivo();
  const mesas = useMesasEnVivo(restaurante.datos?.id ?? null);
  const cobros = usePendientesDeCobro(token);
  useRefrescoEnVivo(cobros.recargar);

  const reporte = ventas.reporte;
  return (
    <div className="mx-auto w-full max-w-container space-y-6 p-4 md:p-6">
      <EncabezadoInicio
        ahora={ahora}
        nombreLocal={restaurante.datos?.nombre ?? null}
        frase="Así viene hoy"
      />

      <ResumenDelDia
        reporte={reporte}
        error={ventas.error}
        salon={resumenSalon(mesas.datos ?? [])}
        conMesas={mesas.datos !== null}
        enCocina={pedidosEnCocina(pedidos)}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TarjetaAtencion
          llamados={alertas?.llamados.length ?? 0}
          porCobrar={cobros.datos?.pedidos.length ?? 0}
          stockBajo={alertas?.alertasStock.length ?? 0}
          cargando={!cobros.datos && !cobros.error}
        />
        <TarjetaMasPedido
          platos={
            reporte ? topPlatos(reporte.platosMasPedidos.porCantidad) : []
          }
          cargando={ventas.cargando}
          error={ventas.error}
          onReintentar={ventas.refrescar}
        />
      </div>

      {reporte && <VentasPorHora ventas={reporte.ventasPorHora} />}

      <AccesosRapidos />
    </div>
  );
}
