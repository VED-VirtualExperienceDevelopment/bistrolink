"use client";

import { useCallback, useEffect, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { useAlertas } from "@/components/alertas/AlertasProvider";
import { apiFetch } from "@/lib/api-client";
import { crearRefrescoDiferido } from "@/components/admin/reportes/reportes.utils";
import type { MesaConLayout, MesaEstadoActualizadoPayload } from "@/types/mesa";
import type { EstadoPedido, Pedido } from "@/types/pedido";
import { cambiarEstadoMesa } from "./inicio.utils";

export interface DatosRemotos<T> {
  datos: T | null;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

/**
 * BL-520: un GET para una tarjeta de Inicio. Si falla, solo esa tarjeta
 * muestra el aviso; el resto de la pantalla sigue igual. Con `ruta` en null
 * no pide nada (por ejemplo, mientras no se sabe el restaurante).
 */
export function useDatosRemotos<T>(
  ruta: string | null,
  mensajeError: string,
): DatosRemotos<T> {
  const { token } = useKeycloakAuth();
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!token || !ruta) return;
    try {
      setDatos(await apiFetch<T>(ruta, token));
      setError(null);
    } catch {
      setError(mensajeError);
    } finally {
      setCargando(false);
    }
  }, [token, ruta, mensajeError]);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  // Estable entre renders: se usa como dependencia de useRefrescoEnVivo.
  const recargarYa = useCallback(() => {
    void recargar();
  }, [recargar]);

  return { datos, cargando, error, recargar: recargarYa };
}

/**
 * Vuelve a llamar a `accion` (2 s después del último evento) cuando el
 * socket del staff avisa de un cambio: un pedido nuevo o que cambió de
 * estado, un pago aprobado o una mesa que cambió de estado. También al
 * reconectar, por si algo cambió sin conexión.
 */
export function useRefrescoEnVivo(accion: () => void): void {
  const socket = useAlertas()?.socket ?? null;

  useEffect(() => {
    if (!socket) return;
    const refresco = crearRefrescoDiferido(accion);
    const eventos = [
      "pedido:nuevo",
      "pedido:actualizado",
      "reportes:actualizado",
      "mesa:estado_actualizado",
      "llamado:nuevo",
      "connect",
    ];
    for (const evento of eventos) socket.on(evento, refresco.programar);
    return () => {
      for (const evento of eventos) socket.off(evento, refresco.programar);
      refresco.cancelar();
    };
  }, [socket, accion]);
}

interface PedidoActualizado {
  id: string;
  estado: EstadoPedido;
  actualizadoEn?: string;
}

/**
 * BL-520: los pedidos activos del local, en vivo, desde el mismo socket que
 * usa el KDS (AlertasProvider lo abre y lo cierra). `listoDesde` guarda la
 * hora en que un pedido pasó a listo, cuando ese cambio llega en vivo.
 */
export function usePedidosEnVivo(): {
  pedidos: Pedido[];
  listoDesde: Record<string, string>;
  cargando: boolean;
} {
  const socket = useAlertas()?.socket ?? null;
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [listoDesde, setListoDesde] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!socket) return;
    const alSnapshot = (snapshot: Pedido[]) => {
      setPedidos(snapshot);
      setCargando(false);
    };
    const alNuevo = (pedido: Pedido) => {
      setPedidos((prev) =>
        prev.some((p) => p.id === pedido.id) ? prev : [...prev, pedido],
      );
    };
    const alActualizado = (cambio: PedidoActualizado) => {
      if (cambio.estado === "LISTO_PARA_ENTREGAR" && cambio.actualizadoEn) {
        const desde = cambio.actualizadoEn;
        setListoDesde((prev) => ({ ...prev, [cambio.id]: desde }));
      }
      setPedidos((prev) =>
        cambio.estado === "ENTREGADO" || cambio.estado === "CANCELADO"
          ? prev.filter((p) => p.id !== cambio.id)
          : prev.map((p) =>
              p.id === cambio.id ? { ...p, estado: cambio.estado } : p,
            ),
      );
    };

    socket.on("pedidos:snapshot", alSnapshot);
    socket.on("pedido:nuevo", alNuevo);
    socket.on("pedido:actualizado", alActualizado);
    // El socket compartido puede estar ya conectado: el servidor mandó los
    // pedidos antes de que esta pantalla existiera, así que se piden de
    // nuevo (igual que KdsBoard).
    if (socket.connected) socket.emit("pedidos:sync");

    return () => {
      socket.off("pedidos:snapshot", alSnapshot);
      socket.off("pedido:nuevo", alNuevo);
      socket.off("pedido:actualizado", alActualizado);
    };
  }, [socket]);

  return { pedidos, listoDesde, cargando: cargando && Boolean(socket) };
}

/**
 * BL-520: las mesas del salón (GET /mesas/layout) con su estado al día: el
 * socket avisa cada cambio (`mesa:estado_actualizado`).
 */
export function useMesasEnVivo(
  restauranteId: string | null,
): DatosRemotos<MesaConLayout[]> {
  const socket = useAlertas()?.socket ?? null;
  const remotas = useDatosRemotos<MesaConLayout[]>(
    restauranteId ? `/mesas/layout?restauranteId=${restauranteId}` : null,
    "No se pudo cargar el estado de las mesas.",
  );
  const [mesas, setMesas] = useState<MesaConLayout[] | null>(null);

  useEffect(() => {
    setMesas(remotas.datos);
  }, [remotas.datos]);

  useEffect(() => {
    if (!socket) return;
    const alCambiar = (cambio: MesaEstadoActualizadoPayload) => {
      setMesas((prev) =>
        prev ? cambiarEstadoMesa(prev, cambio.mesaId, cambio.estado) : prev,
      );
    };
    socket.on("mesa:estado_actualizado", alCambiar);
    return () => {
      socket.off("mesa:estado_actualizado", alCambiar);
    };
  }, [socket]);

  return { ...remotas, datos: mesas };
}

/** El restaurante del local (el primero que devuelve la API, como el mapa). */
export function useRestaurante(): DatosRemotos<{ id: string; nombre: string }> {
  const lista = useDatosRemotos<{ id: string; nombre: string }[]>(
    "/restaurantes",
    "No se pudo cargar el local.",
  );
  return { ...lista, datos: lista.datos?.[0] ?? null };
}
