"use client";

import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { useAlertas } from "@/components/alertas/AlertasProvider";
import { fechaLarga, saludo } from "./inicio.utils";
import { Icono } from "./TarjetaInicio";

interface Props {
  /** Hora actual (ms), del reloj de la pantalla. */
  readonly ahora: number;
  readonly nombreLocal: string | null;
  /** «Así viene hoy» (admin) o «Tu turno en» (mozo). */
  readonly frase: string;
}

/**
 * BL-520: saludo según la hora, nombre de la persona, local y fecha. A la
 * derecha, si los datos llegan en vivo (socket del staff conectado).
 */
export function EncabezadoInicio({ ahora, nombreLocal, frase }: Props) {
  const { usuario } = useKeycloakAuth();
  const conectado = useAlertas()?.conectado ?? false;
  const fecha = new Date(ahora);

  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-label-md text-on-surface-variant">
          {fechaLarga(fecha)}
        </p>
        <h1 className="text-headline-lg-mobile text-primary md:text-headline-lg">
          {saludo(fecha, usuario?.nombre)}
        </h1>
        <p className="text-body-md text-on-surface-variant">
          {frase} {nombreLocal ?? "tu restaurante"}.
        </p>
      </div>
      <p
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-label-md ${
          conectado
            ? "bg-green-100 text-green-900"
            : "bg-surface-container-high text-on-surface-variant"
        }`}
      >
        <Icono
          nombre={conectado ? "sensors" : "sensors_off"}
          className="text-[16px]"
        />
        {conectado ? "En vivo" : "Sin conexión en vivo"}
      </p>
    </header>
  );
}
