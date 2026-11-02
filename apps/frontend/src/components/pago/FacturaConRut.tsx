"use client";

import { useId } from "react";
import {
  erroresFactura,
  facturaSinConsentimiento,
  LARGO_MAXIMO_RAZON_SOCIAL_RECEPTOR,
  type FormularioFactura,
} from "./factura.utils";

/** Ids de los campos, para llevar el foco al primero con error. */
export const ID_RUT_FACTURA = "factura-rut";
export const ID_RAZON_SOCIAL_FACTURA = "factura-razon-social";

const CLASE_INPUT =
  "w-full h-12 px-3 rounded-lg border bg-white text-foreground placeholder:text-[#79767d] focus:outline-none transition-colors";
const CLASE_INPUT_OK =
  "border-culinary-neutral/30 focus:border-[#6e54ad] focus:ring-2 focus:ring-[#6e54ad]/20";
const CLASE_INPUT_ERROR = "border-[#BA1A1A] bg-[#FFDAD6]/40";

/**
 * HU-009 (BL-453): el comensal pide e-Factura con su RUT y su razón social,
 * antes de pagar (el CFE se emite cuando se aprueba el pago).
 *
 * HU-036 (BL-206): el aviso de privacidad va antes de guardar los datos. Sin
 * aceptarlo no se mandan y se emite un e-Ticket; se le dice al comensal.
 */
export function FacturaConRut({
  valor,
  onCambiar,
  mostrarErrores,
  rutaPrivacidad,
  deshabilitado,
}: {
  readonly valor: FormularioFactura;
  readonly onCambiar: (valor: FormularioFactura) => void;
  /** Después de intentar pagar con datos incompletos. */
  readonly mostrarErrores: boolean;
  readonly rutaPrivacidad: string;
  readonly deshabilitado: boolean;
}) {
  const idAyudaRut = useId();
  const idErrorRut = useId();
  const idErrorRazon = useId();
  const idAviso = useId();
  const errores = mostrarErrores ? erroresFactura(valor) : {};
  const cambiar = <K extends keyof FormularioFactura>(
    campo: K,
    nuevo: FormularioFactura[K],
  ) => onCambiar({ ...valor, [campo]: nuevo });

  return (
    <section
      aria-labelledby="titulo-factura"
      className="bg-white rounded-[1rem] border border-culinary-neutral/15 p-5 md:p-6 shadow-[0px_4px_20px_rgba(121,118,125,0.08)]"
    >
      <h2 id="titulo-factura" className="sr-only">
        Comprobante fiscal
      </h2>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={valor.quiere}
          disabled={deshabilitado}
          onChange={(e) => cambiar("quiere", e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[#6e54ad]"
        />
        <span className="flex flex-col">
          <span className="font-semibold text-foreground">
            Quiero e-Factura con RUT
          </span>
          <span className="text-xs text-[#5a575e]">
            Si no la pedís, te damos un e-Ticket (consumidor final).
          </span>
        </span>
      </label>

      {valor.quiere && (
        <div className="mt-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={ID_RUT_FACTURA}
              className="text-sm font-medium text-foreground"
            >
              RUT
            </label>
            <input
              id={ID_RUT_FACTURA}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              placeholder="12 dígitos"
              value={valor.rut}
              disabled={deshabilitado}
              onChange={(e) => cambiar("rut", e.target.value)}
              aria-invalid={Boolean(errores.rut)}
              aria-describedby={
                errores.rut ? `${idAyudaRut} ${idErrorRut}` : idAyudaRut
              }
              className={`${CLASE_INPUT} ${errores.rut ? CLASE_INPUT_ERROR : CLASE_INPUT_OK}`}
            />
            <p id={idAyudaRut} className="text-xs text-[#5a575e]">
              Podés escribirlo con puntos o guiones.
            </p>
            {errores.rut && (
              <p
                id={idErrorRut}
                className="text-xs font-semibold text-[#BA1A1A]"
              >
                {errores.rut}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={ID_RAZON_SOCIAL_FACTURA}
              className="text-sm font-medium text-foreground"
            >
              Razón social
            </label>
            <input
              id={ID_RAZON_SOCIAL_FACTURA}
              type="text"
              autoComplete="organization"
              maxLength={LARGO_MAXIMO_RAZON_SOCIAL_RECEPTOR}
              value={valor.razonSocial}
              disabled={deshabilitado}
              onChange={(e) => cambiar("razonSocial", e.target.value)}
              aria-invalid={Boolean(errores.razonSocial)}
              aria-describedby={errores.razonSocial ? idErrorRazon : undefined}
              className={`${CLASE_INPUT} ${
                errores.razonSocial ? CLASE_INPUT_ERROR : CLASE_INPUT_OK
              }`}
            />
            {errores.razonSocial && (
              <p
                id={idErrorRazon}
                className="text-xs font-semibold text-[#BA1A1A]"
              >
                {errores.razonSocial}
              </p>
            )}
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={valor.consentimiento}
              disabled={deshabilitado}
              onChange={(e) => cambiar("consentimiento", e.target.checked)}
              aria-describedby={idAviso}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#6e54ad]"
            />
            <span className="text-sm text-foreground">
              Acepto que el local guarde mi RUT y mi razón social para emitir la
              e-Factura.{" "}
              <a
                href={rutaPrivacidad}
                className="underline hover:text-[#6e54ad]"
              >
                Política de privacidad
              </a>
            </span>
          </label>
          <p id={idAviso} className="text-xs text-[#5a575e]" aria-live="polite">
            {facturaSinConsentimiento(valor)
              ? "Sin aceptar, no guardamos estos datos y te damos un e-Ticket."
              : "Figuran en la e-Factura, que se conserva 5 años por obligación fiscal."}
          </p>
        </div>
      )}
    </section>
  );
}
