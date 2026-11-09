"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";
import {
  MEDIOS_VENTA_POS,
  mensajeImportacionPos,
  RUTA_IMPORTAR_POS,
  RUTA_SIMULAR_POS,
  RUTA_VENTAS_POS,
  textoResumenVentasPos,
  totalSimulacionValido,
  type MedioVentaPos,
  type ResultadoImportacionPos,
  type ResumenVentasDelPos,
} from "./pos.utils";

const CLASE_BOTON =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-outline px-4 text-label-lg text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50";
const CLASE_CONTROL =
  "min-h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

/**
 * HU-011 (BL-489): las ventas hechas directamente en el POS del local, que
 * BistroLink trae al dashboard (canal «POS del local»). Se traen solas cada
 * minuto; acá se pueden traer en el momento. Con el POS de prueba, además se
 * puede simular una venta de mostrador para la demo.
 */
export default function VentasDelPos({
  token,
  habilitada,
  adaptador,
}: Readonly<{
  token: string;
  habilitada: boolean;
  adaptador: string | null;
}>) {
  const id = useId();
  const [resumen, setResumen] = useState<ResumenVentasDelPos | null>(null);
  const [aviso, setAviso] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [total, setTotal] = useState("");
  const [medio, setMedio] = useState<MedioVentaPos>("EFECTIVO");
  const [errorTotal, setErrorTotal] = useState("");

  const cargar = useCallback(async () => {
    try {
      setResumen(await apiFetch<ResumenVentasDelPos>(RUTA_VENTAS_POS, token));
    } catch (err) {
      setAviso(
        err instanceof ApiError
          ? err.message
          : "No se pudieron cargar las ventas del POS",
      );
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function ejecutar(ruta: string, cuerpo?: object) {
    setTrabajando(true);
    setAviso("");
    try {
      const r = await apiFetch<ResultadoImportacionPos>(ruta, token, {
        method: "POST",
        ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      });
      setAviso(mensajeImportacionPos(r));
      await cargar();
      return true;
    } catch (err) {
      setAviso(
        err instanceof ApiError
          ? err.message
          : "No se pudo conectar con el POS. Probá de nuevo.",
      );
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  async function simular(e: FormEvent) {
    e.preventDefault();
    const valor = totalSimulacionValido(total);
    if (valor === null) {
      setErrorTotal(
        "Ingresá un total entre 1 y 100.000, con hasta 2 decimales.",
      );
      return;
    }
    setErrorTotal("");
    if (await ejecutar(RUTA_SIMULAR_POS, { total: valor, medioPago: medio })) {
      setTotal("");
    }
  }

  const sinPos = adaptador === null;
  const desactivado = trabajando || sinPos || !habilitada;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="space-y-4 rounded-xl border border-outline-variant bg-surface-container-lowest p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`${id}-titulo`} className="text-title-md text-on-surface">
            Ventas hechas en el POS
          </h2>
          <p className="text-body-md text-on-surface-variant">
            {resumen ? textoResumenVentasPos(resumen) : "Cargando…"} Se ven en
            Reportes, en el canal «POS del local».
          </p>
        </div>
        <button
          type="button"
          onClick={() => void ejecutar(RUTA_IMPORTAR_POS)}
          disabled={desactivado}
          className={CLASE_BOTON}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            sync
          </span>{" "}
          Traer ventas ahora
        </button>
      </div>

      {adaptador === "mock" && (
        <form
          onSubmit={(e) => void simular(e)}
          aria-labelledby={`${id}-simular`}
          noValidate
          className="space-y-3 border-t border-outline-variant pt-4"
        >
          <h3 id={`${id}-simular`} className="text-title-sm text-on-surface">
            Simular una venta en el POS de prueba
          </h3>
          <p className="text-body-md text-on-surface-variant">
            Para la demo: registra una venta como si se hubiera cobrado en el
            mostrador y la trae al dashboard.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label
                htmlFor={`${id}-total`}
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Total ($)
              </label>
              <input
                id={`${id}-total`}
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                aria-invalid={errorTotal !== ""}
                aria-describedby={errorTotal ? `${id}-total-error` : undefined}
                className={CLASE_CONTROL}
              />
            </div>
            <div>
              <label
                htmlFor={`${id}-medio`}
                className="mb-1 block text-label-md text-on-surface-variant"
              >
                Medio de pago
              </label>
              <select
                id={`${id}-medio`}
                value={medio}
                onChange={(e) => setMedio(e.target.value as MedioVentaPos)}
                className={CLASE_CONTROL}
              >
                {MEDIOS_VENTA_POS.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.texto}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={desactivado}
              className={CLASE_BOTON}
            >
              Simular venta
            </button>
          </div>
          {errorTotal && (
            <p id={`${id}-total-error`} className="text-body-md text-error">
              {errorTotal}
            </p>
          )}
        </form>
      )}

      {!habilitada && !sinPos && (
        <p className="text-body-md text-on-surface-variant">
          Activá la sincronización para traer las ventas del POS.
        </p>
      )}

      <p
        className="text-body-md text-on-surface"
        aria-live="polite"
        aria-atomic="true"
      >
        {aviso}
      </p>
    </section>
  );
}
