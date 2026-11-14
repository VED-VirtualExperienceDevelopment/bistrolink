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
import type { CambiarCampo } from "./SeccionesConfiguracion";
import type { FormularioConfiguracion } from "./configuracion.utils";

interface SeccionRetiroProps {
  formulario: FormularioConfiguracion;
  /** Error del horario (null hasta que el administrador intenta guardar). */
  error: string | null;
  onCambiar: CambiarCampo;
  className?: string;
}

/**
 * HU-040 (BL-210): sección «Pedidos para retirar» de Configuración. El
 * switch habilita los pedidos por el enlace web del local; las horas fijan
 * una franja diaria (vacías = todo el día; si la de cierre es menor, cruza
 * la medianoche). Se guarda con «Guardar cambios».
 */
export default function SeccionRetiro({
  formulario,
  error,
  onCambiar,
  className = "",
}: Readonly<SeccionRetiroProps>) {
  const describido = error ? "retiro-ayuda retiro-error" : "retiro-ayuda";
  return (
    <section
      aria-labelledby="titulo-retiro"
      className={`${CLASE_TARJETA} ${className}`}
    >
      <h2 id="titulo-retiro" className={CLASE_TITULO_TARJETA}>
        Pedidos para retirar
      </h2>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-body-md text-on-surface">
            Tomar pedidos para retirar
          </p>
          <p id="retiro-descripcion" className={CLASE_AYUDA}>
            Los comensales piden y pagan desde el enlace web del local y lo
            retiran en el mostrador con un código.
          </p>
        </div>
        <Switch
          checked={formulario.retiroHabilitado}
          onChange={(valor) => onCambiar("retiroHabilitado", valor)}
          label="Tomar pedidos para retirar"
          describedBy="retiro-descripcion"
        />
      </div>
      {formulario.retiroHabilitado ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="retiro-desde" className={CLASE_ETIQUETA}>
                Desde
              </label>
              <input
                id="retiro-desde"
                type="time"
                value={formulario.retiroHoraDesde}
                onChange={(e) => onCambiar("retiroHoraDesde", e.target.value)}
                aria-invalid={error !== null}
                aria-describedby={describido}
                className={CLASE_CONTROL}
              />
            </div>
            <div>
              <label htmlFor="retiro-hasta" className={CLASE_ETIQUETA}>
                Hasta
              </label>
              <input
                id="retiro-hasta"
                type="time"
                value={formulario.retiroHoraHasta}
                onChange={(e) => onCambiar("retiroHoraHasta", e.target.value)}
                aria-invalid={error !== null}
                aria-describedby={describido}
                className={CLASE_CONTROL}
              />
            </div>
          </div>
          <p id="retiro-ayuda" className={CLASE_AYUDA}>
            Dejá las dos horas vacías para tomar pedidos todo el día. Si la de
            cierre es antes que la de inicio (por ejemplo, de 19:00 a 01:00), el
            horario cruza la medianoche.
          </p>
          {error && (
            <p id="retiro-error" className={CLASE_ERROR_CAMPO}>
              {error}
            </p>
          )}
        </>
      ) : (
        <p className={CLASE_AYUDA}>
          Desactivado: el enlace web muestra la carta, pero no deja pedir.
        </p>
      )}
    </section>
  );
}
