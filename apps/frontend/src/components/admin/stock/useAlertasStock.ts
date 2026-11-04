"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { abrirSocketStock } from "./socket-stock";
import {
  acumularSinStock,
  anuncioAlerta,
  sinStockVigentes,
  type AlertaStock,
} from "./stock.utils";

const ALERTAS_PATH = "/admin/stock/alertas";

export interface EstadoAlertasStock {
  alertas: AlertaStock[];
  /** Unidades vendidas sin stock por ítem, avisadas en vivo (ADR 0009). */
  sinStock: Record<string, number>;
  /** Texto para la región aria-live. */
  anuncio: string;
  error: string | null;
  /** Repone el stock de un ítem (PATCH /admin/stock). */
  reponer: (itemId: string, stockActual: number) => Promise<void>;
}

/**
 * HU-015 (BL-120): alertas de stock de la campana. Solo para el
 * Administrador (`habilitado`): pide GET /admin/stock/alertas y escucha la
 * sala de administradores del socket del staff (`stock:alerta` al
 * confirmarse un pago, `stock:actualizado` al ajustar el stock). Con cada
 * evento vuelve a pedir la lista; al reconectar, también.
 */
export function useAlertasStock(habilitado: boolean): EstadoAlertasStock {
  const { token } = useKeycloakAuth();
  const [alertas, setAlertas] = useState<AlertaStock[]>([]);
  const [sinStock, setSinStock] = useState<Record<string, number>>({});
  const [anuncio, setAnuncio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const alertasRef = useRef<AlertaStock[]>([]);

  const cargar = useCallback(async () => {
    if (!token || !habilitado) return;
    try {
      const datos = await apiFetch<AlertaStock[]>(ALERTAS_PATH, token);
      alertasRef.current = datos;
      setAlertas(datos);
      setSinStock((actual) => sinStockVigentes(actual, datos));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudieron cargar las alertas de stock",
      );
    }
  }, [token, habilitado]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  }, [cargar]);

  useEffect(() => {
    if (!token || !habilitado) return;
    return abrirSocketStock(token, {
      alAlerta: (alerta) => {
        const texto = anuncioAlerta(alertasRef.current, alerta);
        if (texto) setAnuncio(texto);
        setSinStock((actual) => acumularSinStock(actual, alerta));
      },
      alCambiar: () => {
        void cargarRef.current();
      },
    });
  }, [token, habilitado]);

  const reponer = useCallback(
    async (itemId: string, stockActual: number) => {
      await apiFetch("/admin/stock", token, {
        method: "PATCH",
        body: JSON.stringify({ items: [{ itemId, stockActual }] }),
      });
      const nombre =
        alertasRef.current.find((a) => a.itemId === itemId)?.nombre ?? "ítem";
      setAnuncio(`Stock de ${nombre} actualizado: ${stockActual} unidades`);
      await cargar();
    },
    [token, cargar],
  );

  return { alertas, sinStock, anuncio, error, reponer };
}
