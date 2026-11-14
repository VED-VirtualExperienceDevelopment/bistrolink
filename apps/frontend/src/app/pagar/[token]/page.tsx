import type { Metadata } from "next";
import { PagoPorLink } from "@/components/link-pago/PagoPorLink";

interface PageProps {
  readonly params: Promise<{ readonly token: string }>;
}

// HU-033 (BL-203): la URL lleva el token del link (una credencial para pagar
// el pedido): que no viaje en el header Referer a otros sitios ni la
// indexen los buscadores.
export const metadata: Metadata = {
  title: "Pagar tu pedido",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * HU-033 (BL-203): link de pago que genera el mozo (/pagar/<token>). El
 * comensal lo abre en su celular y paga el pedido. Todo pasa del lado del
 * cliente: el token se valida en el backend.
 */
export default async function PagarPorLinkPage({ params }: PageProps) {
  const { token } = await params;
  return <PagoPorLink token={token} />;
}
