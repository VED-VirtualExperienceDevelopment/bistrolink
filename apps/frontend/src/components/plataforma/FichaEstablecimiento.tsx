"use client";

import type { ReactNode } from "react";
import { textoUltimoIngreso } from "@/components/admin/usuarios/Usuarios.utils";
import type {
  CuentaFicha,
  EstadoEstablecimiento,
  FichaEstablecimiento as Ficha,
} from "@/types/plataforma";
import {
  describirCreadoPor,
  ETIQUETA_ESTADO,
  etiquetaPlan,
  formatearFechaAlta,
  nombreDeCuenta,
} from "./plataforma.utils";

// Las fechas de la plataforma se muestran en hora de Montevideo, como el
// listado (formatearFechaAlta).
const ZONA_PLATAFORMA = "America/Montevideo";

const CLASE_TARJETA =
  "rounded-xl border border-outline-variant bg-surface-container-lowest p-4 md:p-6";

// Estado con ícono y texto (no solo color), como «Alta incompleta» en el
// listado (BL-407).
const ESTILO_ESTADO: Record<
  EstadoEstablecimiento,
  { icono: string; clase: string }
> = {
  ACTIVO: {
    icono: "check_circle",
    clase: "bg-secondary-container text-on-secondary-container",
  },
  SUSPENDIDO: {
    icono: "block",
    clase: "bg-error-container text-on-error-container",
  },
  ALTA_INCOMPLETA: {
    icono: "warning",
    clase: "bg-error-container text-on-error-container",
  },
};

function EstadoBadge({ estado }: Readonly<{ estado: EstadoEstablecimiento }>) {
  const { icono, clase } = ESTILO_ESTADO[estado];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-body-md ${clase}`}
    >
      <span
        className="material-symbols-outlined text-[18px]"
        aria-hidden="true"
      >
        {icono}
      </span>
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}

/** Sección con título propio, para navegar por encabezados. */
function Seccion({
  id,
  titulo,
  children,
}: Readonly<{ id: string; titulo: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={id} className={CLASE_TARJETA}>
      <h2 id={id} className="mb-4 text-headline-sm text-on-surface">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

/** Pares rótulo / dato: una columna en el celular, dos desde `sm:`. */
function Datos({
  filas,
}: Readonly<{ filas: { rotulo: string; dato: ReactNode }[] }>) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
      {filas.map(({ rotulo, dato }) => (
        <div key={rotulo} className="contents">
          <dt className="text-body-md text-on-surface-variant">{rotulo}</dt>
          <dd className="break-words text-body-md text-on-surface">{dato}</dd>
        </div>
      ))}
    </dl>
  );
}

function Fecha({ iso }: Readonly<{ iso: string }>) {
  return <time dateTime={iso}>{formatearFechaAlta(iso)}</time>;
}

function ListaCuentas({
  cuentas,
  vacia,
  etiqueta,
}: Readonly<{ cuentas: CuentaFicha[]; vacia: string; etiqueta: string }>) {
  if (cuentas.length === 0) {
    return <p className="text-body-md text-on-surface-variant">{vacia}</p>;
  }
  return (
    <ul aria-label={etiqueta} className="divide-y divide-outline-variant">
      {cuentas.map((c) => {
        const ingreso = textoUltimoIngreso(
          c.ultimoIngreso,
          Date.now(),
          ZONA_PLATAFORMA,
        );
        return (
          <li
            key={c.username ?? nombreDeCuenta(c)}
            className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"
          >
            <p className="flex flex-wrap items-center gap-2 text-body-lg text-on-surface">
              <span className="break-words font-semibold">
                {nombreDeCuenta(c)}
              </span>
              {!c.activo && (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-body-md text-on-surface-variant">
                  <span
                    className="material-symbols-outlined text-[16px]"
                    aria-hidden="true"
                  >
                    person_off
                  </span>
                  <span>Desactivada</span>
                </span>
              )}
            </p>
            {c.username && (
              <p className="break-all text-body-md text-on-surface-variant">
                <span className="sr-only">Usuario: </span>
                {c.username}
              </p>
            )}
            {ingreso && (
              <p className="text-body-md text-on-surface-variant">
                {ingreso.texto}
                {ingreso.completo && (
                  <span className="sr-only"> ({ingreso.completo})</span>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Indicador({
  valor,
  rotulo,
}: Readonly<{ valor: number; rotulo: string }>) {
  return (
    <div className="rounded-lg bg-surface-container-low p-4">
      <dt className="text-body-md text-on-surface-variant">{rotulo}</dt>
      <dd className="text-headline-md font-semibold text-on-surface">
        {valor}
      </dd>
    </div>
  );
}

const CLASE_ACCION =
  "flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-outline-variant px-4 text-body-md font-medium hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Botón de acción de la ficha, con ícono y texto. */
function BotonAccion({
  icono,
  texto,
  onClick,
  peligro = false,
}: Readonly<{
  icono: string;
  texto: string;
  onClick: () => void;
  peligro?: boolean;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${CLASE_ACCION} ${peligro ? "text-error" : "text-primary"}`}
    >
      <span
        className="material-symbols-outlined text-[20px]"
        aria-hidden="true"
      >
        {icono}
      </span>
      <span>{texto}</span>
    </button>
  );
}

/**
 * BL-411: ficha de un establecimiento para el rol PLATAFORMA. Las acciones
 * llegan de a una: «Editar datos» (BL-412), «Suspender» o «Reactivar»
 * (BL-413, según el estado); recuperar el acceso (BL-414) viene después.
 *
 * Una columna en el celular y la tablet; dos desde `lg:`. Cada bloque es una
 * sección con su encabezado (h2) para navegar con el lector de pantalla, y
 * los datos van en listas de definición (rótulo y dato).
 */
export function FichaEstablecimiento({
  ficha,
  onEditar,
  onSuspender,
  onReactivar,
}: Readonly<{
  ficha: Ficha;
  onEditar?: () => void;
  onSuspender?: () => void;
  onReactivar?: () => void;
}>) {
  const suspendido = ficha.estado === "SUSPENDIDO";
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-headline-lg text-primary">
            {ficha.razonSocial}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-body-md text-on-surface-variant">
            <span className="break-all">RUT {ficha.rut}</span>
            <EstadoBadge estado={ficha.estado} />
          </div>
        </div>
        {/* BL-412: corregir los datos. BL-413: suspender o reactivar, según
            el estado. En el celular van una debajo de la otra. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap md:justify-end">
          {onEditar && (
            <BotonAccion icono="edit" texto="Editar datos" onClick={onEditar} />
          )}
          {suspendido && onReactivar && (
            <BotonAccion
              icono="play_circle"
              texto="Reactivar"
              onClick={onReactivar}
            />
          )}
          {!suspendido && onSuspender && (
            <BotonAccion
              icono="block"
              texto="Suspender"
              onClick={onSuspender}
              peligro
            />
          )}
        </div>
      </div>

      {suspendido && ficha.suspension && (
        <div className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <p className="font-semibold">
            Suspendido
            {ficha.suspension.desde && (
              <>
                {" "}
                desde el <Fecha iso={ficha.suspension.desde} />
              </>
            )}
          </p>
          <p>
            Motivo: {ficha.suspension.motivo?.trim() || "sin motivo registrado"}
          </p>
        </div>
      )}

      {ficha.estado === "ALTA_INCOMPLETA" && (
        <div className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <p>
            El alta no terminó: falta{" "}
            {ficha.restaurante
              ? "crear alguna de las cuentas"
              : "el restaurante"}
            . Completala desde el listado con «Completar alta».
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion id="ficha-establecimiento" titulo="Establecimiento">
          <Datos
            filas={[
              { rotulo: "Razón social", dato: ficha.razonSocial },
              { rotulo: "RUT", dato: ficha.rut },
              { rotulo: "Plan", dato: etiquetaPlan(ficha.plan) },
              {
                rotulo: "Alta",
                dato: (
                  <>
                    <Fecha iso={ficha.creadoEl} />
                    {" · "}
                    {describirCreadoPor(ficha.creadoPor)}
                  </>
                ),
              },
              {
                rotulo: "Alta completa",
                dato: ficha.altaCompletadaEn ? (
                  <Fecha iso={ficha.altaCompletadaEn} />
                ) : (
                  "Pendiente"
                ),
              },
            ]}
          />
        </Seccion>

        <Seccion id="ficha-restaurante" titulo="Restaurante">
          {ficha.restaurante ? (
            <Datos
              filas={[
                { rotulo: "Nombre", dato: ficha.restaurante.nombre },
                { rotulo: "Dirección", dato: ficha.restaurante.direccion },
                { rotulo: "Zona horaria", dato: ficha.restaurante.timezone },
              ]}
            />
          ) : (
            <p className="text-body-md text-on-surface-variant">
              Todavía no tiene restaurante.
            </p>
          )}
        </Seccion>

        <Seccion id="ficha-administradores" titulo="Administradores">
          <ListaCuentas
            cuentas={ficha.administradores}
            etiqueta="Administradores"
            vacia="No tiene Administradores. Sin uno, nadie del restaurante puede gestionar usuarios."
          />
        </Seccion>

        <Seccion id="ficha-cocina" titulo="Cuenta de Cocina">
          <ListaCuentas
            cuentas={ficha.cocina}
            etiqueta="Cuenta de Cocina"
            vacia="No se encontró la cuenta de Cocina (o Keycloak no respondió)."
          />
        </Seccion>

        <Seccion id="ficha-resumen" titulo="Resumen">
          {ficha.resumen ? (
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador valor={ficha.resumen.mesas} rotulo="Mesas del salón" />
              <Indicador
                valor={ficha.resumen.itemsCarta}
                rotulo="Ítems de la carta"
              />
              <Indicador
                valor={ficha.resumen.pedidosRecientes}
                rotulo={`Pedidos (últimos ${ficha.resumen.diasPedidos} días)`}
              />
              <Indicador
                valor={ficha.resumen.pedidosAbiertos}
                rotulo="Pedidos abiertos"
              />
            </dl>
          ) : (
            <p className="text-body-md text-on-surface-variant">
              Sin datos: el establecimiento todavía no tiene restaurante.
            </p>
          )}
        </Seccion>
      </div>
    </div>
  );
}
