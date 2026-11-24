"use client";

import { useEffect, useReducer } from "react";
import type { Socket } from "socket.io-client";
import {
  DEMORA_DESCONECTADO_MS,
  esperaConexion,
  siguienteEstadoConexion,
  type EstadoConexion,
} from "./estado-conexion.utils";

/**
 * HU-038 (BL-504): estado de la conexión de un socket, para el indicador
 * (IndicadorConexion). Escucha el socket (connect, disconnect,
 * connect_error) y la red del navegador (online, offline). No abre ni cierra
 * el socket: eso lo sigue haciendo cada pantalla.
 *
 * `socket` puede ser null mientras la pantalla todavía no lo abrió (por
 * ejemplo, sin token): el estado queda en «conectando».
 */
export function useEstadoConexion(
  socket: Socket | null,
  demoraMs: number = DEMORA_DESCONECTADO_MS,
): EstadoConexion {
  const [estado, despachar] = useReducer(siguienteEstadoConexion, "conectando");

  useEffect(() => {
    if (!socket) return;

    const alConectar = () => despachar("conectado");
    const alPerder = () =>
      despachar(navigator.onLine === false ? "sin-red" : "perdido");
    // «io client disconnect» es la pantalla cerrando su propio socket (al
    // salir o al renovar el token): no es un corte.
    const alDesconectar = (motivo: string) => {
      if (motivo !== "io client disconnect") alPerder();
    };
    const alSinRed = () => despachar("sin-red");
    const alConRed = () =>
      despachar(socket.connected ? "conectado" : "con-red");

    despachar(socket.connected ? "conectado" : "perdido");
    socket.on("connect", alConectar);
    socket.on("disconnect", alDesconectar);
    socket.on("connect_error", alPerder);
    window.addEventListener("offline", alSinRed);
    window.addEventListener("online", alConRed);

    return () => {
      socket.off("connect", alConectar);
      socket.off("disconnect", alDesconectar);
      socket.off("connect_error", alPerder);
      window.removeEventListener("offline", alSinRed);
      window.removeEventListener("online", alConRed);
    };
  }, [socket]);

  // Mientras se espera la conexión, a los `demoraMs` pasa a «desconectado».
  // Los intentos fallidos no reinician la cuenta: el estado no cambia, así
  // que este efecto no se vuelve a ejecutar.
  useEffect(() => {
    if (!esperaConexion(estado)) return;
    const temporizador = setTimeout(
      () => despachar("demora-vencida"),
      demoraMs,
    );
    return () => clearTimeout(temporizador);
  }, [estado, demoraMs]);

  return estado;
}
