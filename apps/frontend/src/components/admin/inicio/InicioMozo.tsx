"use client";

import Link from "next/link";
import { useAlertas } from "@/components/alertas/AlertasProvider";
import { usePendientesDeCobro } from "@/components/admin/cobros/usePendientesDeCobro";
import {
  codigoDelPedido,
  formatearMonto,
} from "@/components/admin/cobros/cobros.utils";
import {
  RUTA_CARTA_STAFF,
  type CategoriaCartaStaff,
} from "@/components/admin/pedido-mozo/pedido-mozo.utils";
import { CLASE_FOCO } from "@/components/admin/reportes/reportes.estilos";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { useReloj } from "@/components/kds/useReloj";
import type { LlamadoMozo } from "@/components/kds/llamado.utils";
import { EncabezadoInicio } from "./EncabezadoInicio";
import {
  FILAS_POR_TARJETA,
  lugarDelPedido,
  MINUTOS_LISTO_DEMORADO,
  minutosDesde,
  pedidosEnCocina,
  pedidosListos,
  platosAgotados,
  resumenSalon,
  textoHaceCuanto,
  type PedidoListo,
  type ResumenSalon,
} from "./inicio.utils";
import {
  FilaEnlace,
  Icono,
  Insignia,
  SinPendientes,
  TarjetaInicio,
} from "./TarjetaInicio";
import {
  type DatosRemotos,
  useDatosRemotos,
  useMesasEnVivo,
  usePedidosEnVivo,
  useRefrescoEnVivo,
  useRestaurante,
} from "./useInicio";

const RELOJ_MS = 30_000;

/** «Mesa 4 llama al mozo» / «Mesa 9 paga en efectivo · $ 1.240». */
function textoDelLlamado(llamado: LlamadoMozo): string {
  if (llamado.motivo !== "PAGO_EFECTIVO") {
    return `Mesa ${llamado.mesaNumero} llama al mozo`;
  }
  const total = llamado.total ? ` · ${formatearMonto(llamado.total)}` : "";
  return `Mesa ${llamado.mesaNumero} paga en efectivo${total}`;
}

function EstadoSalon({ resumen }: Readonly<{ resumen: ResumenSalon }>) {
  const celdas: { etiqueta: string; valor: number; resaltar?: boolean }[] = [
    { etiqueta: "Libres", valor: resumen.libres },
    { etiqueta: "Ocupadas", valor: resumen.ocupadas },
    { etiqueta: "Pagando", valor: resumen.pagando },
    {
      etiqueta: "Para limpiar",
      valor: resumen.paraLimpiar,
      resaltar: resumen.paraLimpiar > 0,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {celdas.map((c) => (
        <div
          key={c.etiqueta}
          className={`flex flex-col-reverse items-center rounded-lg p-3 ${
            c.resaltar
              ? "bg-amber-100 text-amber-900"
              : "bg-surface-container-low text-on-surface"
          }`}
        >
          <dt className="text-body-sm">{c.etiqueta}</dt>
          <dd className="text-headline-sm">{c.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function TarjetaTeLlaman({
  llamados,
  ahora,
}: Readonly<{ llamados: LlamadoMozo[]; ahora: number }>) {
  const hay = llamados.length > 0;
  return (
    <TarjetaInicio
      id="inicio-te-llaman"
      titulo="Te llaman"
      icono="notifications_active"
      insignia={hay && <Insignia tono="peligro">{llamados.length}</Insignia>}
      enlace={
        llamados.length > FILAS_POR_TARJETA
          ? { href: "/admin/alertas", texto: "Ver todas las alertas" }
          : undefined
      }
    >
      {hay ? (
        <ul className="-mx-2">
          {llamados.slice(0, FILAS_POR_TARJETA).map((l) => (
            <FilaEnlace key={l.mesaId} href="/admin/alertas">
              <span className="flex-1">{textoDelLlamado(l)}</span>
              <span className="text-body-sm text-on-surface-variant">
                {textoHaceCuanto(minutosDesde(l.ts, ahora))}
              </span>
            </FilaEnlace>
          ))}
        </ul>
      ) : (
        <SinPendientes>Ninguna mesa te está llamando.</SinPendientes>
      )}
    </TarjetaInicio>
  );
}

function FilaListo({
  pedido,
  ahora,
}: Readonly<{ pedido: PedidoListo; ahora: number }>) {
  const minutos = minutosDesde(pedido.desde, ahora);
  const demorado = minutos >= MINUTOS_LISTO_DEMORADO;
  const lugar = lugarDelPedido(pedido);
  return (
    <FilaEnlace href="/admin/kds">
      <Insignia tono="neutro">{lugar}</Insignia>
      <span className="min-w-0 flex-1 truncate">{pedido.platos}</span>
      <span
        className={`whitespace-nowrap text-body-sm ${
          demorado ? "font-semibold text-amber-800" : "text-on-surface-variant"
        }`}
      >
        {textoHaceCuanto(minutos)}
      </span>
    </FilaEnlace>
  );
}

function TarjetaListos({
  listos,
  enCocina,
  cargando,
  ahora,
}: Readonly<{
  listos: PedidoListo[];
  enCocina: number;
  cargando: boolean;
  ahora: number;
}>) {
  const hay = listos.length > 0;
  const cocina =
    enCocina > 0 ? ` La cocina tiene ${enCocina} en preparación.` : "";
  return (
    <TarjetaInicio
      id="inicio-listos"
      titulo="Listos para llevar"
      icono="room_service"
      cargando={cargando}
      insignia={hay && <Insignia tono="exito">{listos.length}</Insignia>}
      enlace={{ href: "/admin/kds", texto: "Ir al KDS" }}
    >
      {hay ? (
        <ul className="-mx-2">
          {listos.slice(0, FILAS_POR_TARJETA).map((p) => (
            <FilaListo key={p.id} pedido={p} ahora={ahora} />
          ))}
        </ul>
      ) : (
        <SinPendientes>No hay pedidos esperando.{cocina}</SinPendientes>
      )}
    </TarjetaInicio>
  );
}

function TarjetaCobros({
  cobros,
}: Readonly<{ cobros: ReturnType<typeof usePendientesDeCobro> }>) {
  const pendientes = cobros.datos?.pedidos ?? [];
  const hay = pendientes.length > 0;
  return (
    <TarjetaInicio
      id="inicio-cobros"
      titulo="Cobros pendientes"
      icono="payments"
      cargando={!cobros.datos && !cobros.error}
      error={cobros.error}
      onReintentar={() => void cobros.recargar()}
      insignia={hay && <Insignia tono="aviso">{pendientes.length}</Insignia>}
      enlace={
        pendientes.length > FILAS_POR_TARJETA
          ? { href: "/admin/cobros", texto: "Ver todos los cobros" }
          : undefined
      }
    >
      {hay ? (
        <ul className="-mx-2">
          {pendientes.slice(0, FILAS_POR_TARJETA).map((p) => (
            <FilaEnlace key={p.id} href="/admin/cobros">
              <span className="flex-1">
                {p.mesa.esVirtual
                  ? `Retiro ${codigoDelPedido(p.id)}`
                  : `Mesa ${p.mesa.numero}`}
              </span>
              <span className="font-semibold">{formatearMonto(p.total)}</span>
            </FilaEnlace>
          ))}
        </ul>
      ) : (
        <SinPendientes>No hay cobros pendientes.</SinPendientes>
      )}
    </TarjetaInicio>
  );
}

function TarjetaAgotados({
  carta,
}: Readonly<{ carta: DatosRemotos<CategoriaCartaStaff[]> }>) {
  const agotados = carta.datos ? platosAgotados(carta.datos) : [];
  return (
    <TarjetaInicio
      id="inicio-agotados"
      titulo="Agotados hoy"
      icono="block"
      cargando={carta.cargando}
      error={carta.error}
      onReintentar={carta.recargar}
      enlace={{ href: "/admin/menu", texto: "Ir a la carta" }}
      className="lg:col-span-2"
    >
      {agotados.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {agotados.map((nombre) => (
            <li
              key={nombre}
              className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1 text-body-md text-on-surface-variant"
            >
              {nombre}
            </li>
          ))}
        </ul>
      ) : (
        <SinPendientes>Todo el menú está disponible.</SinPendientes>
      )}
    </TarjetaInicio>
  );
}

/**
 * BL-520: Inicio del mozo. Lo que tiene que hacer ahora, ordenado por
 * urgencia y en vivo. Sin datos de ventas (Reportes es solo del
 * administrador).
 */
export function InicioMozo() {
  const ahora = useReloj(RELOJ_MS);
  const { token } = useKeycloakAuth();
  const alertas = useAlertas();
  const restaurante = useRestaurante();
  const { pedidos, listoDesde, cargando: cargandoPedidos } = usePedidosEnVivo();
  const mesas = useMesasEnVivo(restaurante.datos?.id ?? null);
  const cobros = usePendientesDeCobro(token);
  const carta = useDatosRemotos<CategoriaCartaStaff[]>(
    RUTA_CARTA_STAFF,
    "No se pudo cargar la carta.",
  );
  useRefrescoEnVivo(cobros.recargar);
  useRefrescoEnVivo(carta.recargar);

  return (
    <div className="mx-auto w-full max-w-container space-y-6 p-4 md:p-6">
      <EncabezadoInicio
        ahora={ahora}
        nombreLocal={restaurante.datos?.nombre ?? null}
        frase="Tu turno en"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TarjetaTeLlaman llamados={alertas?.llamados ?? []} ahora={ahora} />
        <TarjetaListos
          listos={pedidosListos(pedidos, listoDesde)}
          enCocina={pedidosEnCocina(pedidos)}
          cargando={cargandoPedidos}
          ahora={ahora}
        />
        <TarjetaInicio
          id="inicio-salon"
          titulo="Salón"
          icono="table_restaurant"
          cargando={mesas.cargando}
          error={mesas.error}
          onReintentar={mesas.recargar}
          enlace={{ href: "/admin/mesas", texto: "Ver el mapa" }}
        >
          <EstadoSalon resumen={resumenSalon(mesas.datos ?? [])} />
        </TarjetaInicio>
        <TarjetaCobros cobros={cobros} />
        <TarjetaAgotados carta={carta} />
      </div>

      <Link
        href="/admin/mesas"
        className={`flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-body-lg font-semibold text-on-primary hover:bg-primary-container lg:inline-flex ${CLASE_FOCO}`}
      >
        <Icono nombre="table_restaurant" />
        Ir al mapa de mesas
      </Link>
    </div>
  );
}
