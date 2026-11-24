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
  /** HU-010 (BL-613): error del número del bot de WhatsApp. */
  errorWhatsapp?: string | null;
  /** HU-010 (BL-613): el bot de WhatsApp atiende al local. */
  botConectado?: boolean;
  onCambiar: CambiarCampo;
  className?: string;
}

/**
 * HU-040 (BL-210): sección «Pedidos para retirar» de Configuración. El
 * switch habilita los pedidos por el enlace web del local; las horas fijan
 * una franja diaria (vacías = todo el día; si la de cierre es menor, cruza
 * la medianoche). Se guarda con «Guardar cambios».
 *
 * HU-010 (BL-613): el número del bot de WhatsApp, para que el menú para
 * retirar ofrezca «¿Preferís pedir por WhatsApp?». Solo se ofrece si el bot
 * atiende al local; si no, la pantalla lo avisa.
 */
export default function SeccionRetiro({
  formulario,
  error,
  errorWhatsapp = null,
  botConectado = false,
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
          {formulario.whatsappPedidos !== null && (
            <CampoWhatsapp
              valor={formulario.whatsappPedidos}
              error={errorWhatsapp}
              botConectado={botConectado}
              onCambiar={(valor) => onCambiar("whatsappPedidos", valor)}
            />
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

/** HU-010 (BL-613): número del bot de WhatsApp (opcional). */
function CampoWhatsapp({
  valor,
  error,
  botConectado,
  onCambiar,
}: Readonly<{
  valor: string;
  error: string | null;
  botConectado: boolean;
  onCambiar: (valor: string) => void;
}>) {
  const ayudas = ["retiro-whatsapp-ayuda", "retiro-whatsapp-estado"];
  if (error) ayudas.push("retiro-whatsapp-error");
  return (
    <div>
      <label htmlFor="retiro-whatsapp" className={CLASE_ETIQUETA}>
        WhatsApp del bot (opcional)
      </label>
      <input
        id="retiro-whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        placeholder="099 123 456"
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        aria-invalid={error !== null}
        aria-describedby={ayudas.join(" ")}
        className={CLASE_CONTROL}
      />
      <p id="retiro-whatsapp-ayuda" className={CLASE_AYUDA}>
        El menú para retirar muestra «¿Preferís pedir por WhatsApp?» con este
        número. Vacío: no se muestra.
      </p>
      <p id="retiro-whatsapp-estado" className={CLASE_AYUDA}>
        {botConectado
          ? "El bot de WhatsApp está conectado para este local."
          : "El bot de WhatsApp todavía no está conectado para este local: el enlace no se va a mostrar hasta que lo esté."}
      </p>
      {error && (
        <p id="retiro-whatsapp-error" className={CLASE_ERROR_CAMPO}>
          {error}
        </p>
      )}
    </div>
  );
}
