"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import FiltrosReportes from "@/components/admin/reportes/FiltrosReportes";
import EstadoEnVivo from "@/components/admin/reportes/EstadoEnVivo";
import TarjetasResumen from "@/components/admin/reportes/TarjetasResumen";
import VentasPorHora from "@/components/admin/reportes/VentasPorHora";
import DentroFueraDelLocal from "@/components/admin/reportes/DentroFueraDelLocal";
import PlatosMasPedidos from "@/components/admin/reportes/PlatosMasPedidos";
import SkeletonReportes from "@/components/admin/reportes/SkeletonReportes";
import { useReportes } from "@/components/admin/reportes/useReportes";
import {
  filtrosIniciales,
  rangoInvalido,
  type FiltrosReportes as Filtros,
} from "@/components/admin/reportes/reportes.utils";

/**
 * HU-012 (BL-108): dashboard de reportes de ventas. Solo Administrador (el
 * backend responde 403 a los demás roles). Los datos se actualizan solos con
 * cada cobro y cada mesa que se cierra.
 */
export default function ReportesPage() {
  const { hasRole } = useKeycloakAuth();
  const router = useRouter();
  const esAdmin = hasRole("ADMIN");

  useEffect(() => {
    if (!esAdmin) router.replace("/admin/mesas");
  }, [esAdmin, router]);

  const [filtros, setFiltros] = useState<Filtros>(() => filtrosIniciales());
  const estado = useReportes(filtros);
  const invalido = rangoInvalido(filtros);

  if (!esAdmin) return null;

  const { reporte } = estado;
  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Reportes</h1>
        <p className="text-body-md text-on-surface-variant">
          Ventas, platos más pedidos y rotación de mesas de tu restaurante.
        </p>
      </div>

      <FiltrosReportes
        filtros={filtros}
        invalido={invalido}
        onCambiar={setFiltros}
      />

      <EstadoEnVivo
        enVivo={estado.enVivo}
        actualizadoEn={estado.actualizadoEn}
        actualizando={estado.actualizando}
        anuncio={estado.anuncio}
        onActualizar={estado.refrescar}
      />

      {estado.error && (
        <p
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {estado.error}
        </p>
      )}

      {estado.cargando && !invalido && <SkeletonReportes />}
      {!estado.cargando && reporte && !invalido && (
        <div className="space-y-4">
          <TarjetasResumen reporte={reporte} periodo={filtros.periodo} />
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <VentasPorHora ventas={reporte.ventasPorHora} />
            <DentroFueraDelLocal reporte={reporte} />
          </div>
          <PlatosMasPedidos reporte={reporte} />
        </div>
      )}
    </div>
  );
}
