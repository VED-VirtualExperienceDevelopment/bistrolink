"use client";

import Switch from "@/components/ui/Switch";
import {
  CLASE_AYUDA,
  CLASE_CONTROL,
  CLASE_ERROR_CAMPO,
  CLASE_ETIQUETA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./configuracion.estilos";
import {
  LIMITE_PREPARACION,
  MINUTOS_ESPERA,
  MINUTOS_PREPARACION,
  UMBRAL_ALERTA_COLA,
  type ErroresCola,
  type FormularioConfiguracion,
} from "./configuracion.utils";

type CambiarCampo = <K extends keyof FormularioConfiguracion>(
  campo: K,
  valor: FormularioConfiguracion[K],
) => void;

interface CampoColaProps {
  id: string;
  etiqueta: string;
  ayuda: string;
  valor: string;
  error: string | undefined;
  rango: { minimo: number; maximo: number };
  onChange: (valor: string) => void;
}

/**
 * HU-042 (BL-465): un campo numérico de la cola del KDS, con su ayuda y su
 * error asociados para el lector de pantalla.
 */
function CampoCola({
  id,
  etiqueta,
  ayuda,
  valor,
  error,
  rango,
  onChange,
}: Readonly<CampoColaProps>) {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ETIQUETA}>
        {etiqueta}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={rango.minimo}
        max={rango.maximo}
        step={1}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${id}-ayuda ${id}-error` : `${id}-ayuda`}
        className={CLASE_CONTROL}
      />
      <p id={`${id}-ayuda`} className={`mt-1 ${CLASE_AYUDA}`}>
        {ayuda}
      </p>
      {error && (
        <p id={`${id}-error`} className={CLASE_ERROR_CAMPO}>
          {error}
        </p>
      )}
    </div>
  );
}

interface SeccionCocinaProps {
  formulario: FormularioConfiguracion;
  /** Errores a mostrar (vacío hasta que el administrador intenta guardar). */
  errores: ErroresCola;
  onCambiar: CambiarCampo;
  /** BL-473: clases extra del layout (por ejemplo, ocupar las 2 columnas). */
  className?: string;
}

/**
 * HU-042 (BL-465): sección «Cocina» de Configuración. El switch activa la
 * cola automática del KDS; con la cola activa se muestran el límite de
 * pedidos en preparación, el umbral de alta demanda y los minutos de
 * referencia del tiempo estimado. Se guarda con «Guardar cambios», como el
 * resto de la pantalla.
 *
 * HU-038 (BL-506): también los umbrales de espera de las comandas del KDS
 * (Atención, Demorado y Demora alta). No dependen de la cola: se muestran
 * siempre.
 */
export default function SeccionCocina({
  formulario,
  errores,
  onCambiar,
  className = "",
}: Readonly<SeccionCocinaProps>) {
  return (
    <section
      aria-labelledby="titulo-cocina"
      className={`${CLASE_TARJETA} ${className}`}
    >
      <h2 id="titulo-cocina" className={CLASE_TITULO_TARJETA}>
        Cocina
      </h2>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body-md text-on-surface">
            Cola automática de pedidos
          </p>
          <p id="cola-descripcion" className={CLASE_AYUDA}>
            Limita cuántos pedidos prepara la cocina a la vez. Los demás esperan
            en orden de llegada y pasan a preparación solos cuando se marca uno
            como listo.
          </p>
        </div>
        <Switch
          checked={formulario.colaActiva}
          onChange={(valor) => onCambiar("colaActiva", valor)}
          label="Cola automática de pedidos"
          describedBy="cola-descripcion"
        />
      </div>
      {formulario.colaActiva ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CampoCola
            id="cola-limite"
            etiqueta="Pedidos en preparación a la vez"
            ayuda={`Entre ${LIMITE_PREPARACION.minimo} y ${LIMITE_PREPARACION.maximo}.`}
            valor={formulario.limitePreparacion}
            error={errores.limitePreparacion}
            rango={LIMITE_PREPARACION}
            onChange={(valor) => onCambiar("limitePreparacion", valor)}
          />
          <CampoCola
            id="cola-umbral"
            etiqueta="Alerta de alta demanda con más de"
            ayuda="Pedidos en espera. El KDS muestra un aviso."
            valor={formulario.umbralAlertaCola}
            error={errores.umbralAlertaCola}
            rango={UMBRAL_ALERTA_COLA}
            onChange={(valor) => onCambiar("umbralAlertaCola", valor)}
          />
          <CampoCola
            id="cola-minutos"
            etiqueta="Minutos de preparación por pedido"
            ayuda="Base del tiempo estimado que ve el comensal."
            valor={formulario.minutosPreparacion}
            error={errores.minutosPreparacion}
            rango={MINUTOS_PREPARACION}
            onChange={(valor) => onCambiar("minutosPreparacion", valor)}
          />
        </div>
      ) : (
        <p className={CLASE_AYUDA}>
          Desactivada: el mozo pasa cada pedido a preparación desde el KDS, sin
          límite.
        </p>
      )}

      {/* HU-038 (BL-506): umbrales de espera de las comandas del KDS. */}
      <fieldset className="mt-2 border-t border-outline-variant pt-4">
        <legend className="text-body-md text-on-surface">
          Tiempo de espera en el KDS
        </legend>
        <p id="espera-descripcion" className={`mb-3 ${CLASE_AYUDA}`}>
          Cada comanda cambia de color y de texto según cuánto hace que llegó.
          Por defecto: Atención desde los 30 minutos, Demorado desde los 60 y
          Demora alta desde los 120.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CampoCola
            id="espera-atencion"
            etiqueta="«Atención» desde (minutos)"
            ayuda={`Entre ${MINUTOS_ESPERA.minimo} y ${MINUTOS_ESPERA.maximo}.`}
            valor={formulario.esperaAtencion}
            error={errores.esperaAtencion}
            rango={MINUTOS_ESPERA}
            onChange={(valor) => onCambiar("esperaAtencion", valor)}
          />
          <CampoCola
            id="espera-demorado"
            etiqueta="«Demorado» desde (minutos)"
            ayuda="Mayor que «Atención»."
            valor={formulario.esperaDemorado}
            error={errores.esperaDemorado}
            rango={MINUTOS_ESPERA}
            onChange={(valor) => onCambiar("esperaDemorado", valor)}
          />
          <CampoCola
            id="espera-demora-alta"
            etiqueta="«Demora alta» desde (minutos)"
            ayuda="Mayor que «Demorado»."
            valor={formulario.esperaDemoraAlta}
            error={errores.esperaDemoraAlta}
            rango={MINUTOS_ESPERA}
            onChange={(valor) => onCambiar("esperaDemoraAlta", valor)}
          />
        </div>
      </fieldset>
    </section>
  );
}
