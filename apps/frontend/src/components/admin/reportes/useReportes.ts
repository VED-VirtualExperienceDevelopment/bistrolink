"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { esDesconexionInesperada } from "@/components/admin/mesas/mapa-mesas.utils";
import {
  crearRefrescoDiferido,
  EVENTOS_REPORTES,
  rangoInvalido,
  rutaReportes,
  type FiltrosReportes,
  type ReporteVentas,
} from "./reportes.utils";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface EstadoReportes {
  reporte: ReporteVentas | null;
  /** Primera carga (o cambio de filtros): la pantalla muestra skeletons. */
  cargando: boolean;
  /** Recarga en segundo plano: se mantienen los datos que ya se ven. */
  actualizando: boolean;
  error: string | null;
  /** El socket está conectado: los datos se actualizan solos. */
  enVivo: boolean;
  actualizadoEn: Date | null;
  /** Texto para la región aria-live («Datos actualizados»). */
  anuncio: string;
  /** Botón «Actualizar»: vuelve a pedir los datos ya. */
  refrescar: () => void;
}

/**
 * HU-012 (BL-108): datos del dashboard de reportes.
 *
 * - Pide GET /admin/reportes con los filtros. Si los filtros cambian
 *   mientras una respuesta está en camino, esa respuesta se descarta.
 * - Tiempo real (D4): se conecta al socket del staff (KdsGateway, el mismo
 *   del mapa de mesas) y, ante un cobro o un cambio de estado de mesa,
 *   vuelve a pedir los datos 2 s después del último evento, sin vaciar la
 *   pantalla. Al reconectar también vuelve a pedirlos, por lo que pudo
 *   cambiar mientras no había conexión.
 */
export function useReportes(filtros: FiltrosReportes): EstadoReportes {
  const { token } = useKeycloakAuth();
  const [reporte, setReporte] = useState<ReporteVentas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enVivo, setEnVivo] = useState(false);
  const [actualizadoEn, setActualizadoEn] = useState<Date | null>(null);
  const [anuncio, setAnuncio] = useState("");
  // Número del último pedido: una respuesta de un pedido anterior se
  // descarta.
  const ultimoPedido = useRef(0);
  const invalido = rangoInvalido(filtros);
  const ruta = rutaReportes(filtros);

  const cargar = useCallback(
    async (enSegundoPlano: boolean) => {
      if (!token) return;
      if (invalido) {
        // La pantalla avisa del rango inválido; no hay nada que cargar.
        setCargando(false);
        return;
      }
      const numero = ++ultimoPedido.current;
      if (enSegundoPlano) setActualizando(true);
      else setCargando(true);
      try {
        const datos = await apiFetch<ReporteVentas>(ruta, token);
        if (numero !== ultimoPedido.current) return;
        setReporte(datos);
        setError(null);
        const ahora = new Date();
        setActualizadoEn(ahora);
        if (enSegundoPlano) {
          setAnuncio(
            `Datos actualizados a las ${ahora.toLocaleTimeString("es-UY", {
              hour: "2-digit",
              minute: "2-digit",
            })}`,
          );
        }
      } catch (err) {
        if (numero !== ultimoPedido.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudieron cargar los reportes",
        );
      } finally {
        if (numero === ultimoPedido.current) {
          setCargando(false);
          setActualizando(false);
        }
      }
    },
    [token, ruta, invalido],
  );

  // Cada cambio de filtros: carga completa (con skeletons).
  useEffect(() => {
    void cargar(false);
  }, [cargar]);

  // La función del socket siempre usa la última versión de `cargar` (los
  // filtros actuales) sin volver a conectarse cuando cambian.
  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  }, [cargar]);

  useEffect(() => {
    if (!token) return;
    const refresco = crearRefrescoDiferido(() => {
      void cargarRef.current(true);
    });
    const socket = io(WS_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    let huboConexion = false;

    for (const evento of EVENTOS_REPORTES) {
      socket.on(evento, refresco.programar);
    }
    socket.on("connect", () => {
      setEnVivo(true);
      if (huboConexion) refresco.programar();
      huboConexion = true;
    });
    socket.on("disconnect", (motivo) => {
      if (!esDesconexionInesperada(motivo)) return;
      setEnVivo(false);
      // Si lo cortó el servidor, socket.io no reintenta solo.
      if (motivo === "io server disconnect") socket.connect();
    });
    socket.on("connect_error", () => setEnVivo(false));

    return () => {
      refresco.cancelar();
      socket.disconnect();
    };
  }, [token]);

  const refrescar = useCallback(() => {
    void cargar(true);
  }, [cargar]);

  return {
    reporte,
    cargando,
    actualizando,
    error,
    enVivo,
    actualizadoEn,
    anuncio,
    refrescar,
  };
}
