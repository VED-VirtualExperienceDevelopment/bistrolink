"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { apiFetch, ApiError } from "@/lib/api-client";
import { abrirSocketStock } from "./socket-stock";
import {
  ajustesParaGuardar,
  formularioDesde,
  fusionarConServidor,
  reemplazarItems,
  textoGuardado,
  type FilaStock,
  type FormularioStock,
  type ItemStock,
} from "./stock-jornada.utils";

const STOCK_PATH = "/admin/stock";

export interface EstadoStockJornada {
  /** Lo guardado en el servidor; null mientras carga. */
  items: ItemStock[] | null;
  formulario: FormularioStock;
  errorCarga: string | null;
  errorGuardar: string | null;
  /** Texto para la región aria-live. */
  aviso: string;
  guardando: boolean;
  cambiarFila: (itemId: string, cambios: Partial<FilaStock>) => void;
  guardar: () => Promise<void>;
  descartar: () => void;
}

/**
 * HU-015 (BL-120): datos de «Stock de la jornada». Pide GET /admin/stock y
 * guarda con un solo PATCH. Si mientras se edita llega una venta o un
 * ajuste desde otra pestaña, actualiza los campos que no se tocaron y deja
 * como están los que sí (fusionarConServidor).
 */
export function useStockJornada(habilitado: boolean): EstadoStockJornada {
  const { token } = useKeycloakAuth();
  const [items, setItems] = useState<ItemStock[] | null>(null);
  const [formulario, setFormulario] = useState<FormularioStock>({});
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);
  const itemsRef = useRef<ItemStock[] | null>(null);

  const cargar = useCallback(async () => {
    if (!token || !habilitado) return;
    try {
      const nuevos = await apiFetch<ItemStock[]>(STOCK_PATH, token);
      const anteriores = itemsRef.current;
      itemsRef.current = nuevos;
      setItems(nuevos);
      setFormulario((actual) =>
        anteriores
          ? fusionarConServidor(anteriores, nuevos, actual)
          : formularioDesde(nuevos),
      );
      setErrorCarga(null);
    } catch (err) {
      setErrorCarga(
        err instanceof ApiError ? err.message : "No se pudo cargar el stock",
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
      alCambiar: () => {
        void cargarRef.current();
      },
    });
  }, [token, habilitado]);

  const cambiarFila = useCallback(
    (itemId: string, cambios: Partial<FilaStock>) => {
      setFormulario((actual) => {
        const fila = actual[itemId];
        return fila ? { ...actual, [itemId]: { ...fila, ...cambios } } : actual;
      });
      setAviso("");
      setErrorGuardar(null);
    },
    [],
  );

  const guardar = useCallback(async () => {
    const guardados = itemsRef.current;
    if (!guardados) return;
    const ajustes = ajustesParaGuardar(guardados, formulario);
    if (ajustes.length === 0) {
      // Por ejemplo, «05» donde había 5: el mismo valor escrito distinto.
      setFormulario(formularioDesde(guardados));
      setAviso("No había cambios para guardar.");
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    setAviso("");
    try {
      const respuesta = await apiFetch<ItemStock[]>(STOCK_PATH, token, {
        method: "PATCH",
        body: JSON.stringify({ items: ajustes }),
      });
      const nuevos = reemplazarItems(itemsRef.current ?? guardados, respuesta);
      itemsRef.current = nuevos;
      setItems(nuevos);
      setFormulario((actual) => ({
        ...actual,
        ...formularioDesde(respuesta),
      }));
      setAviso(textoGuardado(ajustes.length));
    } catch (err) {
      setErrorGuardar(
        err instanceof ApiError ? err.message : "No se pudo guardar el stock",
      );
    } finally {
      setGuardando(false);
    }
  }, [formulario, token]);

  const descartar = useCallback(() => {
    if (!itemsRef.current) return;
    setFormulario(formularioDesde(itemsRef.current));
    setErrorGuardar(null);
    setAviso("Se descartaron los cambios.");
  }, []);

  return {
    items,
    formulario,
    errorCarga,
    errorGuardar,
    aviso,
    guardando,
    cambiarFila,
    guardar,
    descartar,
  };
}
