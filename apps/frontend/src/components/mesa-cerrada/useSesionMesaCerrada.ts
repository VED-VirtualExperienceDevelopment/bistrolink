"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { OrigenMenu } from "@/components/menu-digital.utils";
import {
  borrarPedidoEnCurso,
  almacenDelNavegador,
  clavePedidoEnCurso,
} from "@/components/pago/pedido-en-curso.utils";
import {
  almacenPersistente,
  claveMisPedidos,
  olvidarMisPedidos,
} from "@/components/mis-pedidos/mis-pedidos.utils";
import {
  esCierreDeEstaSesion,
  EVENTO_SEGUIR_MESA,
  EVENTO_SESION_CERRADA,
  type AvisoSesionCerrada,
} from "./sesion-mesa.utils";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * BL-518: true cuando el mozo cerró la mesa. Sigue la sesión por el
 * WebSocket; al cerrarse, borra del teléfono lo guardado de esa sesión
 * («Mis pedidos» y el pago en curso).
 *
 * Al volver a la pestaña (el celular se bloqueó, cambió de app) se vuelve a
 * preguntar: si el socket se cortó sin reconectarse, así se entera igual. En
 * el pedido para retirar no hace nada (no hay mesa).
 */
export function useSesionMesaCerrada(
  origen: OrigenMenu,
  identificar: (origen: OrigenMenu) => Promise<string>,
): boolean {
  const mesa = origen.tipo === "mesa" ? origen : null;
  const qrToken = mesa?.qrToken;
  const sesionMesa = mesa?.sesionMesa;
  const [cerrada, setCerrada] = useState(false);

  useEffect(() => {
    if (!mesa || !qrToken || !sesionMesa) return;
    let activo = true;
    let socket: ReturnType<typeof io> | null = null;

    const seguir = () =>
      socket?.emit(EVENTO_SEGUIR_MESA, { qrToken, sesionMesa });

    const alVolver = () => {
      if (document.visibilityState !== "visible" || !socket) return;
      if (socket.connected) seguir();
      else socket.connect();
    };

    void (async () => {
      let token: string;
      try {
        token = await identificar(mesa);
      } catch {
        // Sin token no se puede seguir la sesión; la próxima acción del
        // comensal recibe el 410 de siempre.
        return;
      }
      if (!activo) return;
      socket = io(WS_URL, {
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });
      // También en cada reconexión: si se cerró mientras estaba cortado, el
      // backend avisa enseguida.
      socket.on("connect", seguir);
      socket.on(EVENTO_SESION_CERRADA, (aviso: AvisoSesionCerrada) => {
        if (!esCierreDeEstaSesion(aviso, sesionMesa)) return;
        olvidarMisPedidos(
          almacenPersistente(),
          claveMisPedidos(qrToken, sesionMesa),
        );
        borrarPedidoEnCurso(
          almacenDelNavegador(mesa),
          clavePedidoEnCurso(mesa),
        );
        setCerrada(true);
        socket?.disconnect();
      });
      document.addEventListener("visibilitychange", alVolver);
    })();

    return () => {
      activo = false;
      document.removeEventListener("visibilitychange", alVolver);
      socket?.disconnect();
    };
    // identificar y la mesa no cambian mientras la carta está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrToken, sesionMesa]);

  return cerrada;
}
