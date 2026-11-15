"use client";

import { useEffect, useRef, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  rangoInvalido,
  type FiltrosReportes,
} from "@/components/admin/reportes/reportes.utils";
import {
  rutaValoraciones,
  type ValoracionesDelPeriodo,
} from "./valoraciones.utils";

export interface EstadoValoraciones {
  datos: ValoracionesDelPeriodo | null;
  cargando: boolean;
  error: string | null;
}

/**
 * HU-050 (BL-558): datos de /admin/valoraciones. Se piden al abrir y con
 * cada cambio de filtros; si cambian mientras una respuesta está en camino,
 * esa respuesta se descarta.
 */
export function useValoraciones(filtros: FiltrosReportes): EstadoValoraciones {
  const { token } = useKeycloakAuth();
  const [datos, setDatos] = useState<ValoracionesDelPeriodo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ultimoPedido = useRef(0);
  const invalido = rangoInvalido(filtros);
  const ruta = rutaValoraciones(filtros);

  useEffect(() => {
    if (!token) return;
    if (invalido) {
      setCargando(false);
      return;
    }
    const numero = ++ultimoPedido.current;
    setCargando(true);
    apiFetch<ValoracionesDelPeriodo>(ruta, token)
      .then((respuesta) => {
        if (numero !== ultimoPedido.current) return;
        setDatos(respuesta);
        setError(null);
      })
      .catch((err: unknown) => {
        if (numero !== ultimoPedido.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudieron cargar las valoraciones",
        );
      })
      .finally(() => {
        if (numero === ultimoPedido.current) setCargando(false);
      });
  }, [token, ruta, invalido]);

  return { datos, cargando, error };
}
