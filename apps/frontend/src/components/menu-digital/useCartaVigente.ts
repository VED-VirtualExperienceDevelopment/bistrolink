"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CategoriaMenu } from "@/components/MenuDigital";
import type { OrigenMenu } from "@/components/menu-digital.utils";
import {
  categoriasDeRespuesta,
  debeRecargarAlVolver,
  rutaCartaVigente,
} from "@/components/menu-digital/carta-vigente.utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * BL-570: la carta que se muestra al comensal, con la disponibilidad
 * vigente. Arranca con la que trajo la página y se vuelve a pedir:
 * - al volver a la pestaña (`visibilitychange`) o a la ventana (`focus`),
 *   si `activa` (el comensal está viendo la carta, no el pago) y pasó la
 *   espera mínima;
 * - cuando la pantalla llama a `recargar` (pedido rechazado por la carta).
 *
 * Si la API falla o responde con error (mesa cerrada, local suspendido), se
 * deja la carta que estaba: esos casos ya los avisa la pantalla al pedir.
 */
export function useCartaVigente(
  origen: OrigenMenu,
  categoriasIniciales: readonly CategoriaMenu[],
  activa: boolean,
): {
  categorias: readonly CategoriaMenu[];
  recargar: () => Promise<void>;
} {
  const [categorias, setCategorias] =
    useState<readonly CategoriaMenu[]>(categoriasIniciales);
  const ultimaCarga = useRef(Date.now());
  const recargando = useRef(false);
  const ruta = rutaCartaVigente(origen);

  // Si la página vuelve a renderizar con otra carta, se toma esa.
  useEffect(() => {
    setCategorias(categoriasIniciales);
    ultimaCarga.current = Date.now();
  }, [categoriasIniciales]);

  const recargar = useCallback(async () => {
    if (!ruta || recargando.current) return;
    recargando.current = true;
    try {
      const res = await fetch(`${API_URL}${ruta}`, { cache: "no-store" });
      if (!res.ok) return;
      const nuevas = categoriasDeRespuesta(await res.json());
      if (nuevas) setCategorias(nuevas);
    } catch {
      // Sin conexión: queda la carta que se estaba viendo.
    } finally {
      // También si falló: así no se vuelve a pedir en cada cambio de pestaña.
      ultimaCarga.current = Date.now();
      recargando.current = false;
    }
  }, [ruta]);

  useEffect(() => {
    if (!activa || !ruta) return;
    const alCambiarVisibilidad = () => {
      if (
        debeRecargarAlVolver(
          document.visibilityState === "visible",
          ultimaCarga.current,
          Date.now(),
        )
      ) {
        void recargar();
      }
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    // En la computadora, pasar de otra ventana a la de la carta no cambia la
    // visibilidad (las dos se ven): se usa también el foco de la ventana.
    window.addEventListener("focus", alCambiarVisibilidad);
    return () => {
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("focus", alCambiarVisibilidad);
    };
  }, [activa, ruta, recargar]);

  return { categorias, recargar };
}
