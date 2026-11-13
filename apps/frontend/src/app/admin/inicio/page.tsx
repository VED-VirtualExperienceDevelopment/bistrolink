"use client";

import { useKeycloakAuth } from "@/components/providers/KeycloakProvider";
import { InicioAdmin } from "@/components/admin/inicio/InicioAdmin";
import { InicioMozo } from "@/components/admin/inicio/InicioMozo";

/**
 * BL-520: pantalla de Inicio, adonde llegan el administrador y el mozo al
 * entrar. El administrador ve cómo viene el día (ventas, pedidos, mesas y
 * pendientes); el mozo, lo que tiene que hacer ahora, sin datos de ventas.
 * AdminShell ya deja entrar solo a ADMIN y MOZO.
 */
export default function InicioPage() {
  const { hasRole } = useKeycloakAuth();
  return hasRole("ADMIN") ? <InicioAdmin /> : <InicioMozo />;
}
