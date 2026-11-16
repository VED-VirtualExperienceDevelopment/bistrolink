"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import FiltrosReportes from "@/components/admin/reportes/FiltrosReportes";
import { rangoInvalido } from "@/components/admin/reportes/reportes.utils";
import ResumenValoraciones from "@/components/admin/valoraciones/ResumenValoraciones";
import ComentariosValoraciones from "@/components/admin/valoraciones/ComentariosValoraciones";
import { useValoraciones } from "@/components/admin/valoraciones/useValoraciones";
import { filtrosInicialesValoraciones } from "@/components/admin/valoraciones/valoraciones.utils";

const BLOQUE = "animate-pulse rounded-xl bg-surface-container-high";

/**
 * HU-050 (BL-558): valoraciones privadas de los clientes. Solo
 * Administrador (el backend responde 403 a los demás roles). No muestra el
 * pedido, la mesa ni la hora de cada valoración.
 */
export default function ValoracionesPage() {
  const { hasRole } = useKeycloakAuth();
  const router = useRouter();
  const esAdmin = hasRole("ADMIN");

  useEffect(() => {
    if (!esAdmin) router.replace("/admin/mesas");
  }, [esAdmin, router]);

  const [filtros, setFiltros] = useState(() => filtrosInicialesValoraciones());
  const { datos, cargando, error } = useValoraciones(filtros);
  const invalido = rangoInvalido(filtros);

  if (!esAdmin) return null;

  return (
    <div className="w-full space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-headline-lg text-primary">Valoraciones</h1>
        <p className="text-body-md text-on-surface-variant">
          Lo que opinan tus clientes de sus pedidos. Son privadas: no se
          publican y no muestran la mesa, el pedido ni la hora.
        </p>
      </div>

      <FiltrosReportes
        filtros={filtros}
        invalido={invalido}
        onCambiar={setFiltros}
        etiqueta="Filtrar las valoraciones"
        conCanal={false}
      />

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-error-container px-4 py-3 text-body-md text-on-error-container"
        >
          {error}
        </p>
      )}

      {cargando && !invalido && (
        <div aria-busy="true" className="space-y-4">
          <span className="sr-only">Cargando las valoraciones…</span>
          <div aria-hidden="true" className="grid gap-4 lg:grid-cols-[2fr_3fr]">
            <div className={`${BLOQUE} h-48`} />
            <div className={`${BLOQUE} h-48`} />
          </div>
          <div aria-hidden="true" className={`${BLOQUE} h-64`} />
        </div>
      )}
      {!cargando && datos && !invalido && (
        <div className="space-y-4">
          <ResumenValoraciones datos={datos} />
          <ComentariosValoraciones datos={datos} />
        </div>
      )}
    </div>
  );
}
