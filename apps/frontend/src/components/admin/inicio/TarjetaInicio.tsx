"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  CLASE_AYUDA,
  CLASE_ENLACE,
  CLASE_FOCO,
} from "@/components/admin/reportes/reportes.estilos";

export type TonoInsignia = "peligro" | "aviso" | "exito" | "neutro";

const CLASE_TONO: Record<TonoInsignia, string> = {
  peligro: "bg-error-container text-on-error-container",
  aviso: "bg-amber-100 text-amber-900",
  exito: "bg-green-100 text-green-900",
  neutro: "bg-secondary-container text-on-secondary-container",
};

export function Insignia({
  tono,
  children,
}: Readonly<{ tono: TonoInsignia; children: ReactNode }>) {
  return (
    <span
      className={`inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-label-md ${CLASE_TONO[tono]}`}
    >
      {children}
    </span>
  );
}

export function Icono({
  nombre,
  className = "",
}: Readonly<{ nombre: string; className?: string }>) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined text-[20px] ${className}`}
    >
      {nombre}
    </span>
  );
}

interface Props {
  readonly id: string;
  readonly titulo: string;
  readonly icono: string;
  /** Insignia al lado del título (por ejemplo, la cantidad). */
  readonly insignia?: ReactNode;
  /** «Ver todos» al pie, hacia la sección. */
  readonly enlace?: { href: string; texto: string };
  readonly cargando?: boolean;
  /** Si la consulta falló, la tarjeta muestra el aviso en vez del contenido. */
  readonly error?: string | null;
  readonly onReintentar?: () => void;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * BL-520: una tarjeta de Inicio, con el mismo estilo que las de Reportes.
 * Si su consulta falla, solo esta tarjeta avisa; el resto de la pantalla se
 * ve igual.
 */
export function TarjetaInicio({
  id,
  titulo,
  icono,
  insignia,
  enlace,
  cargando = false,
  error = null,
  onReintentar,
  className = "",
  children,
}: Props) {
  return (
    <section
      aria-labelledby={id}
      aria-busy={cargando || undefined}
      className={`flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 md:p-5 ${className}`}
    >
      <div className="flex items-center gap-2">
        <Icono nombre={icono} className="text-primary" />
        <h2 id={id} className="text-body-lg font-semibold text-on-surface">
          {titulo}
        </h2>
        {insignia}
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-error-container/60 p-3 text-body-sm text-on-error-container">
          <Icono nombre="error" />
          <span className="flex-1">{error}</span>
          {onReintentar && (
            <button
              type="button"
              onClick={onReintentar}
              className={`rounded font-semibold underline-offset-2 hover:underline ${CLASE_FOCO}`}
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {!error && cargando && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-container-high" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-surface-container-high" />
        </div>
      )}

      {!error && !cargando && children}

      {enlace && (
        <Link
          href={enlace.href}
          className={`mt-auto self-start ${CLASE_ENLACE}`}
        >
          {enlace.texto}
          <span aria-hidden="true"> →</span>
        </Link>
      )}
    </section>
  );
}

/** Texto de una tarjeta sin nada que mostrar (una invitación, no una disculpa). */
export function SinPendientes({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <p className={`flex items-center gap-2 ${CLASE_AYUDA}`}>
      <Icono nombre="check_circle" className="text-green-700" />
      {children}
    </p>
  );
}

/** Fila con link a la sección: «2 · Cobros pendientes ›». */
export function FilaEnlace({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-body-md text-on-surface hover:bg-surface-container-low ${CLASE_FOCO}`}
      >
        {children}
        <Icono
          nombre="chevron_right"
          className="ml-auto text-on-surface-variant"
        />
      </Link>
    </li>
  );
}
