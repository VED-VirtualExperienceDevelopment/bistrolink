"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  headersMesaQr,
  type OrigenMenu,
} from "@/components/menu-digital.utils";
import type { PosicionEnCola } from "@/components/kds/cola-kds.utils";
import type { EstadoPedido } from "@/types/pedido";
import {
  almacenPersistente,
  aplicarActualizacion,
  claveMisPedidos,
  conservarSolo,
  leerMisPedidos,
  limpiarSesionesAnteriores,
  olvidarMisPedidos,
  recordarPedido,
  RUTA_ESTADO_PEDIDOS_MESA,
  type PedidoDeLaMesa,
} from "./mis-pedidos.utils";

const WS_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export interface MisPedidos {
  /** Los pedidos de esta mesa y sesión, los más nuevos primero. */
  readonly pedidos: readonly PedidoDeLaMesa[];
  /** Lugar en la cola de los que esperan (HU-042), por id. */
  readonly lugares: Readonly<Record<string, PosicionEnCola>>;
  /** JWT con el que se consultaron (para descargar comprobantes). */
  readonly accessToken: string | null;
  /** Recordar un pedido recién pagado. */
  readonly recordar: (pedidoId: string) => void;
}

const SIN_PEDIDOS: MisPedidos = {
  pedidos: [],
  lugares: {},
  accessToken: null,
  recordar: () => undefined,
};

/**
 * BL-502: «Mis pedidos» del comensal en la mesa. Lee los ids que recuerda el
 * navegador, pide su estado al backend (que filtra por mesa y sesión) y los
 * sigue en vivo por el WebSocket (pedido:seguir, el mismo del seguimiento).
 * En el pedido para retirar no hace nada.
 */
export function useMisPedidos(
  origen: OrigenMenu,
  identificar: (origen: OrigenMenu) => Promise<string>,
): MisPedidos {
  const mesa = origen.tipo === "mesa" ? origen : null;
  const clave = mesa ? claveMisPedidos(mesa.qrToken, mesa.sesionMesa) : null;
  const [ids, setIds] = useState<string[]>([]);
  const [pedidos, setPedidos] = useState<PedidoDeLaMesa[]>([]);
  const [lugares, setLugares] = useState<Record<string, PosicionEnCola>>({});
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Al abrir la carta: lo recordado de esta sesión; lo de sesiones
  // anteriores de la mesa se borra.
  useEffect(() => {
    if (!mesa || !clave) return;
    const almacen = almacenPersistente();
    limpiarSesionesAnteriores(almacen, mesa.qrToken, mesa.sesionMesa);
    setIds(leerMisPedidos(almacen, clave));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // Estado de esos pedidos, según el backend.
  useEffect(() => {
    if (!mesa || !clave || ids.length === 0) return;
    let cancelado = false;
    const almacen = almacenPersistente();
    void (async () => {
      try {
        const token = await identificar(mesa);
        const respuesta = await apiFetch<PedidoDeLaMesa[]>(
          RUTA_ESTADO_PEDIDOS_MESA,
          token,
          {
            method: "POST",
            headers: headersMesaQr(mesa),
            body: JSON.stringify({ ids }),
          },
        );
        if (cancelado) return;
        setAccessToken(token);
        setPedidos(respuesta);
        // Lo que el backend no reconoce (otra sesión) se olvida.
        conservarSolo(
          almacen,
          clave,
          respuesta.map((p) => p.id),
        );
      } catch (err) {
        if (cancelado) return;
        // 410: la mesa se cerró o la sesión venció. Lo recordado ya no sirve.
        if (err instanceof ApiError && err.status === 410) {
          olvidarMisPedidos(almacen, clave);
          setPedidos([]);
        }
        // Otro error (red): se deja como estaba; se reintenta al recargar.
      }
    })();
    return () => {
      cancelado = true;
    };
    // identificar y la mesa no cambian mientras la carta está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, ids]);

  // Seguimiento en vivo: los mismos eventos que la pantalla de pago aprobado.
  const seguidos = useMemo(() => pedidos.map((p) => p.id).join(","), [pedidos]);
  useEffect(() => {
    if (!accessToken || !seguidos) return;
    const lista = seguidos.split(",");
    const socket = io(WS_URL, {
      auth: { token: accessToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.on("connect", () => {
      for (const pedidoId of lista) socket.emit("pedido:seguir", { pedidoId });
    });
    socket.on(
      "pedido:actualizado",
      (cambio: {
        id: string;
        estado: EstadoPedido;
        actualizadoEn?: string;
      }) => {
        if (!lista.includes(cambio.id)) return;
        setPedidos((actuales) => aplicarActualizacion(actuales, cambio));
      },
    );
    socket.on("pedido:cola", (lugar: PosicionEnCola) => {
      if (!lista.includes(lugar.pedidoId)) return;
      setLugares((actuales) => ({ ...actuales, [lugar.pedidoId]: lugar }));
    });
    return () => {
      socket.disconnect();
    };
  }, [accessToken, seguidos]);

  const recordar = useCallback(
    (pedidoId: string) => {
      if (!clave) return;
      setIds(recordarPedido(almacenPersistente(), clave, pedidoId));
    },
    [clave],
  );

  if (!mesa) return SIN_PEDIDOS;
  return { pedidos, lugares, accessToken, recordar };
}
