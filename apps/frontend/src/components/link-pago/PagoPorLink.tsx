"use client";

import { useEffect, useState } from "react";
import AvisoMesaQr from "@/components/AvisoMesaQr";
import { PagoPedido } from "@/components/pago/PagoPedido";
import { PagoAprobado } from "@/components/pago/PagoAprobado";
import {
  codigoDeError,
  esEstablecimientoSuspendido,
  MENSAJE_RESTAURANTE_NO_DISPONIBLE,
  solicitudAuthComensal,
  type OrigenMenu,
} from "@/components/menu-digital.utils";
import { HEADER_LINK_PAGO } from "@/components/pago/pago.utils";
import {
  AVISO_LINK_ERROR,
  AVISO_LINK_INVALIDO,
  avisoDelLink,
  esTokenDeLinkValido,
  lineasParaPagar,
  RUTA_LINK_PAGO,
  yaEstaPagado,
  type AvisoLink,
  type ResumenLinkPago,
} from "./link-pago.utils";

interface Props {
  readonly token: string;
}

type Estado =
  | { tipo: "cargando" }
  | { tipo: "aviso"; aviso: AvisoLink }
  | {
      tipo: "pagar" | "aprobado";
      accessToken: string;
      resumen: ResumenLinkPago;
    };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

class ErrorDelLink extends Error {
  constructor(readonly aviso: AvisoLink) {
    super(aviso.titulo);
  }
}

async function avisoDeRespuesta(res: Response): Promise<AvisoLink> {
  const cuerpo: unknown = await res.json().catch(() => null);
  // BL-413: establecimiento suspendido.
  if (esEstablecimientoSuspendido(res.status, cuerpo)) {
    return {
      icono: "🕒",
      titulo: MENSAJE_RESTAURANTE_NO_DISPONIBLE,
      detalle: "Consultá al personal del local.",
    };
  }
  return avisoDelLink(res.status, codigoDeError(cuerpo));
}

/** JWT del comensal a partir del link, y el pedido que se paga. */
async function abrirLink(
  origen: Extract<OrigenMenu, { tipo: "link" }>,
): Promise<{ accessToken: string; resumen: ResumenLinkPago }> {
  const auth = solicitudAuthComensal(origen);
  const authRes = await fetch(`${API_URL}${auth.ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(auth.body),
  });
  if (!authRes.ok) throw new ErrorDelLink(await avisoDeRespuesta(authRes));
  const { accessToken } = (await authRes.json()) as { accessToken: string };

  const res = await fetch(`${API_URL}${RUTA_LINK_PAGO}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      [HEADER_LINK_PAGO]: origen.linkToken,
    },
    cache: "no-store",
  });
  if (!res.ok) throw new ErrorDelLink(await avisoDeRespuesta(res));
  return { accessToken, resumen: (await res.json()) as ResumenLinkPago };
}

/**
 * HU-033 (BL-203): el comensal abre el link de pago que le generó el mozo.
 * Se identifica con el link (sin QR ni ids), ve el pedido y lo paga con el
 * mismo formulario que en la mesa o en el pedido para retirar. Si ya está
 * pagado, ve el estado y el comprobante.
 */
export function PagoPorLink({ token }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const origen: Extract<OrigenMenu, { tipo: "link" }> = {
    tipo: "link",
    linkToken: token,
  };

  useEffect(() => {
    if (!esTokenDeLinkValido(token)) {
      setEstado({ tipo: "aviso", aviso: AVISO_LINK_INVALIDO });
      return;
    }
    let cancelado = false;
    abrirLink({ tipo: "link", linkToken: token })
      .then(({ accessToken, resumen }) => {
        if (cancelado) return;
        setEstado({
          tipo: yaEstaPagado(resumen) ? "aprobado" : "pagar",
          accessToken,
          resumen,
        });
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        setEstado({
          tipo: "aviso",
          aviso: e instanceof ErrorDelLink ? e.aviso : AVISO_LINK_ERROR,
        });
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  if (estado.tipo === "cargando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-culinary-background p-6">
        <p aria-live="polite" className="text-body-md text-[#5a575e]">
          Abriendo tu pedido…
        </p>
      </main>
    );
  }

  if (estado.tipo === "aviso") {
    return (
      <AvisoMesaQr
        icono={estado.aviso.icono}
        titulo={estado.aviso.titulo}
        detalle={estado.aviso.detalle}
      />
    );
  }

  const { resumen, accessToken } = estado;
  const lineas = lineasParaPagar(resumen);
  const total = Number(resumen.consumo);
  const numeroMesa = resumen.mesaNumero ?? undefined;

  return (
    <main className="min-h-screen bg-culinary-background">
      <header className="border-b border-culinary-neutral/15 bg-white px-4 py-4">
        <p className="mx-auto max-w-2xl text-lg font-bold text-[#6e54ad]">
          {resumen.restaurante.nombre}
        </p>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6">
        {estado.tipo === "pagar" ? (
          <PagoPedido
            origen={origen}
            pedidoId={resumen.pedidoId}
            accessToken={accessToken}
            lineas={lineas}
            total={total}
            numeroMesa={numeroMesa}
            onAprobado={() =>
              setEstado({ tipo: "aprobado", accessToken, resumen })
            }
          />
        ) : (
          <PagoAprobado
            origen={origen}
            pedidoId={resumen.pedidoId}
            accessToken={accessToken}
            lineas={lineas}
            total={total}
            numeroMesa={numeroMesa}
            nombreLocal={resumen.restaurante.nombre}
          />
        )}
      </div>
    </main>
  );
}
