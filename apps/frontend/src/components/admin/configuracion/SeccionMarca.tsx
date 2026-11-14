"use client";

import { useState } from "react";
import Image from "next/image";
import ImageUploader from "@/components/menu/ImageUploader";
import {
  PLANTILLAS_MARCA,
  type DefinicionPlantilla,
} from "@/lib/plantillas-marca";
import {
  CLASE_AYUDA,
  CLASE_BOTON_SECUNDARIO,
  CLASE_CONTROL,
  CLASE_ERROR_CAMPO,
  CLASE_ETIQUETA,
  CLASE_TARJETA,
  CLASE_TITULO_TARJETA,
} from "./configuracion.estilos";
import {
  LARGO_MAXIMO_DIRECCION_LOCAL,
  LARGO_MAXIMO_NOMBRE_LOCAL,
  urlDelLogo,
  type ConfiguracionEstablecimiento,
  type FormularioConfiguracion,
} from "./configuracion.utils";
import type { CambiarCampo } from "./SeccionesConfiguracion";

interface SeccionMarcaProps {
  formulario: FormularioConfiguracion;
  guardada: ConfiguracionEstablecimiento;
  onCambiar: CambiarCampo;
  /**
   * Cambia cuando el formulario vuelve a lo guardado (al descartar o al
   * guardar): el cargador del logo se reinicia con la imagen guardada.
   */
  reinicio: number;
  /** HU-043 (BL-561): errores del nombre y la dirección (al guardar). */
  errorNombre: string | null;
  errorDireccion: string | null;
  className?: string;
}

/**
 * HU-043 (BL-533): «Marca del local», pensada para alguien sin
 * conocimientos de diseño.
 *
 * - Logo: el mismo cargador seguro de la carta (BL-385), con destino
 *   `marca`. En el celular el sistema ofrece la cámara o la galería (sin
 *   `capture`, que obligaría a usar la cámara).
 * - Estilo del menú: 4 tarjetas que ya son la vista previa (el encabezado
 *   de la carta con el logo cargado). Son botones de opción nativos: se
 *   eligen con las flechas, tienen nombre accesible y foco visible.
 * - La elegida no se marca solo con el color: lleva un ícono y «Elegida».
 * - Se guarda con «Guardar cambios», junto con el resto.
 * - HU-043 (BL-561): el nombre y la dirección del local, los que aparecen
 *   en el banner de la carta. Solo con un backend que los trae.
 */
export default function SeccionMarca({
  formulario,
  guardada,
  onCambiar,
  reinicio,
  errorNombre,
  errorDireccion,
  className = "",
}: Readonly<SeccionMarcaProps>) {
  // Al quitar el logo, el cargador se reinicia vacío.
  const [quitados, setQuitados] = useState(0);
  const logoUrl = urlDelLogo(guardada, formulario.logo);
  const disponibles = guardada.plantillasDisponibles ?? [];
  const plantillas = PLANTILLAS_MARCA.filter(({ codigo }) =>
    disponibles.includes(codigo),
  );

  function quitarLogo() {
    onCambiar("logo", { tipo: "quitado" });
    setQuitados((n) => n + 1);
  }

  return (
    <section
      aria-labelledby="titulo-marca"
      className={`${CLASE_TARJETA} ${className}`}
    >
      <div>
        <h2 id="titulo-marca" className={CLASE_TITULO_TARJETA}>
          Marca del local
        </h2>
        <p className={CLASE_AYUDA}>
          El logo y los colores con los que tus comensales ven la carta.
        </p>
      </div>

      {formulario.nombreLocal !== null &&
        formulario.direccionLocal !== null && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <CampoTexto
              id="nombre-local"
              etiqueta="Nombre del local"
              ayuda="Es el título de la carta y de la pestaña del navegador."
              valor={formulario.nombreLocal}
              largoMaximo={LARGO_MAXIMO_NOMBRE_LOCAL}
              autoComplete="organization"
              error={errorNombre}
              onCambiar={(valor) => onCambiar("nombreLocal", valor)}
            />
            <CampoTexto
              id="direccion-local"
              etiqueta="Dirección"
              ayuda="Aparece en la carta y en la política de privacidad del local."
              valor={formulario.direccionLocal}
              largoMaximo={LARGO_MAXIMO_DIRECCION_LOCAL}
              autoComplete="street-address"
              error={errorDireccion}
              onCambiar={(valor) => onCambiar("direccionLocal", valor)}
            />
          </div>
        )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          <p className={CLASE_ETIQUETA}>Logo</p>
          <ImageUploader
            key={`${reinicio}-${quitados}`}
            destino="marca"
            inputId="logo-local"
            altVistaPrevia="Logo del local"
            describidoPor="logo-local-ayuda"
            initialPreviewUrl={logoUrl ?? undefined}
            onUploadSuccess={(key, url) =>
              onCambiar("logo", { tipo: "nuevo", key, url })
            }
          />
          <p id="logo-local-ayuda" className={CLASE_AYUDA}>
            Queda mejor un PNG con fondo transparente. Se muestra arriba de la
            carta.
          </p>
          {logoUrl && (
            <button
              type="button"
              onClick={quitarLogo}
              className={CLASE_BOTON_SECUNDARIO}
            >
              Quitar logo
            </button>
          )}
          {formulario.logo.tipo !== "guardado" && (
            // <output>: rol «status» implícito, el lector de pantalla lo anuncia.
            <output className={`block ${CLASE_AYUDA}`}>
              {formulario.logo.tipo === "nuevo"
                ? "El logo nuevo se aplica al guardar los cambios."
                : "El logo se quita al guardar los cambios."}
            </output>
          )}
        </div>

        <fieldset className="min-w-0">
          <legend className={CLASE_ETIQUETA}>Estilo del menú</legend>
          <p className={`mb-3 ${CLASE_AYUDA}`}>
            Elegí el que más se parece a tu local. Cada tarjeta muestra cómo se
            ve el encabezado de la carta.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {plantillas.map((plantilla) => (
              <TarjetaPlantilla
                key={plantilla.codigo}
                plantilla={plantilla}
                elegida={formulario.plantilla === plantilla.codigo}
                logoUrl={logoUrl}
                nombreLocal={formulario.nombreLocal?.trim() || "Tu local"}
                onElegir={() => onCambiar("plantilla", plantilla.codigo)}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

/** HU-043 (BL-561): campo de texto con ayuda y error asociados. */
function CampoTexto({
  id,
  etiqueta,
  ayuda,
  valor,
  largoMaximo,
  autoComplete,
  error,
  onCambiar,
}: Readonly<{
  id: string;
  etiqueta: string;
  ayuda: string;
  valor: string;
  largoMaximo: number;
  autoComplete: string;
  error: string | null;
  onCambiar: (valor: string) => void;
}>) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={CLASE_ETIQUETA}>
        {etiqueta}
      </label>
      <input
        id={id}
        type="text"
        autoComplete={autoComplete}
        maxLength={largoMaximo}
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        aria-invalid={error !== null}
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

/**
 * Una plantilla: botón de opción nativo (oculto a la vista, no al lector de
 * pantalla) con toda la tarjeta como etiqueta. El foco se ve en la tarjeta.
 */
function TarjetaPlantilla({
  plantilla,
  elegida,
  logoUrl,
  nombreLocal,
  onElegir,
}: Readonly<{
  plantilla: DefinicionPlantilla;
  elegida: boolean;
  logoUrl: string | null;
  nombreLocal: string;
  onElegir: () => void;
}>) {
  const id = `plantilla-${plantilla.codigo}`;
  return (
    <label
      htmlFor={id}
      className={`flex min-h-11 min-w-0 cursor-pointer flex-col gap-3 rounded-xl border-2 p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary ${
        elegida
          ? "border-primary bg-surface-container-low"
          : "border-outline-variant hover:bg-surface-container-low"
      }`}
    >
      <input
        id={id}
        type="radio"
        name="plantilla"
        value={plantilla.codigo}
        checked={elegida}
        onChange={onElegir}
        className="sr-only scroll-mb-28"
      />

      {/* Vista previa: el encabezado de la carta con esta plantilla. Es
          decorativa: el nombre y la descripción van en el texto. */}
      <div
        aria-hidden="true"
        className="flex h-14 min-w-0 items-center gap-2 rounded-lg px-3"
        style={{ backgroundColor: plantilla.colorMarca }}
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white">
          {logoUrl ? (
            <Image
              src={logoUrl}
              alt=""
              fill
              unoptimized
              className="object-contain p-0.5"
            />
          ) : (
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ color: plantilla.colorMarca }}
            >
              restaurant
            </span>
          )}
        </span>
        <span className="min-w-0 truncate text-body-md font-semibold text-white">
          {nombreLocal}
        </span>
        <span
          className="ml-auto shrink-0 rounded-full bg-white px-2 py-0.5 text-label-sm font-medium"
          style={{ color: plantilla.colorAcento }}
        >
          Destacado
        </span>
      </div>

      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-body-md font-medium text-on-surface">
            {plantilla.nombre}
          </span>
          <span className={`block ${CLASE_AYUDA}`}>{plantilla.paraQuien}</span>
        </span>
        {elegida && (
          <span className="flex shrink-0 items-center gap-1 text-label-md text-primary">
            <span
              className="material-symbols-outlined text-[18px]"
              aria-hidden="true"
            >
              check_circle
            </span>
            Elegida
          </span>
        )}
      </div>

      <span aria-hidden="true" className="flex flex-wrap items-center gap-3">
        <Muestra color={plantilla.colorMarca} texto="Principal" />
        <Muestra color={plantilla.colorAcento} texto="Acento" />
      </span>
    </label>
  );
}

function Muestra({ color, texto }: Readonly<{ color: string; texto: string }>) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-5 w-5 rounded-full border border-outline"
        style={{ backgroundColor: color }}
      />
      <span className={CLASE_AYUDA}>{texto}</span>
    </span>
  );
}
