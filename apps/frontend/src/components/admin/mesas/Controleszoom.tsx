"use client";

import {
  porcentajeZoom,
  siguienteZoom,
  ZOOM_INICIAL,
  ZOOM_MAXIMO,
  ZOOM_MINIMO,
} from "./mapa-mesas.utils";

interface Props {
  zoom: number;
  onCambiarZoom: (zoom: number) => void;
  /** Zoom para que el salón entero entre a lo ancho del recuadro. */
  onAjustarAncho: () => void;
  /** false donde el navegador no tiene pantalla completa (Safari de iPhone). */
  admitePantallaCompleta: boolean;
  pantallaCompleta: boolean;
  onAlternarPantallaCompleta: () => void;
}

const ESTILO_BOTON_ICONO =
  "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-50 touch:min-h-12 touch:min-w-12";

function Icono({ nombre }: Readonly<{ nombre: string }>) {
  return (
    <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
      {nombre}
    </span>
  );
}

/**
 * HU-028 (BL-173): controles de zoom del mapa de mesas: alejar, volver al
 * 100 %, acercar, ajustar al ancho y pantalla completa. Separado de
 * MapaMesasEditor para que el editor no siga creciendo (complejidad
 * cognitiva de Sonar).
 */
export function ControlesZoom({
  zoom,
  onCambiarZoom,
  onAjustarAncho,
  admitePantallaCompleta,
  pantallaCompleta,
  onAlternarPantallaCompleta,
}: Readonly<Props>) {
  const etiquetaPantallaCompleta = pantallaCompleta
    ? "Salir de pantalla completa"
    : "Ver el mapa en pantalla completa";

  return (
    <fieldset className="flex items-center gap-1 rounded-lg border border-outline-variant p-1 touch:gap-2">
      <legend className="sr-only">Zoom del mapa</legend>
      <button
        type="button"
        onClick={() => onCambiarZoom(siguienteZoom(zoom, -1))}
        disabled={zoom <= ZOOM_MINIMO}
        aria-label="Alejar"
        title="Alejar"
        className={ESTILO_BOTON_ICONO}
      >
        <Icono nombre="zoom_out" />
      </button>
      <button
        type="button"
        onClick={() => onCambiarZoom(ZOOM_INICIAL)}
        title="Volver al 100%"
        aria-label={`Zoom ${porcentajeZoom(zoom)}. Volver al 100%`}
        className="min-h-[44px] min-w-[4rem] rounded-md px-2 text-center text-label-md text-on-surface-variant hover:bg-surface-container-low touch:min-h-12"
      >
        {porcentajeZoom(zoom)}
      </button>
      <button
        type="button"
        onClick={() => onCambiarZoom(siguienteZoom(zoom, 1))}
        disabled={zoom >= ZOOM_MAXIMO}
        aria-label="Acercar"
        title="Acercar"
        className={ESTILO_BOTON_ICONO}
      >
        <Icono nombre="zoom_in" />
      </button>
      <button
        type="button"
        onClick={onAjustarAncho}
        aria-label="Ajustar el mapa al ancho de la pantalla"
        title="Ajustar al ancho"
        className={ESTILO_BOTON_ICONO}
      >
        <Icono nombre="fit_screen" />
      </button>
      {admitePantallaCompleta && (
        <button
          type="button"
          onClick={onAlternarPantallaCompleta}
          aria-pressed={pantallaCompleta}
          aria-label={etiquetaPantallaCompleta}
          title={etiquetaPantallaCompleta}
          className={ESTILO_BOTON_ICONO}
        >
          <Icono nombre={pantallaCompleta ? "fullscreen_exit" : "fullscreen"} />
        </button>
      )}
    </fieldset>
  );
}
