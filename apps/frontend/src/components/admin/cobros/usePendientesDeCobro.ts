"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { RUTA_PENDIENTES, type PendientesDeCobro } from "./cobros.utils";

/**
 * HU-031 (BL-201): pedidos que esperan el pago (GET /cobros/pendientes).
 * `activo` en false no consulta (por ejemplo, sin mesa seleccionada).
 */
export function usePendientesDeCobro(
  token: string | undefined,
  activo = true,
) {
  const [datos, setDatos] = useState<PendientesDeCobro | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!token || !activo) return;
    setCargando(true);
    setError(null);
    try {
      setDatos(await apiFetch<PendientesDeCobro>(RUTA_PENDIENTES, token));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "No se pudieron cargar los pedidos pendientes de pago.",
      );
    } finally {
      setCargando(false);
    }
  }, [token, activo]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { datos, cargando, error, recargar };
}
