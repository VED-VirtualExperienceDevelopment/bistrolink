import type { Metadata } from "next";
import localFont from "next/font/local";
import { FrontendObservability } from "@/components/providers/FrontendObservability";
import { KeycloakProvider } from "@/components/providers/KeycloakProvider";
import { VersionInfo } from "@/components/ui/VersionInfo";
import "./globals.css";

// BL-222: única tipografía de la app, autoalojada en ./fonts para que el
// build no dependa de Google Fonts. Es la versión variable (pesos 200 a 800
// en un solo archivo), subconjunto latin, de @fontsource-variable/plus-jakarta-sans
// 5.3.0. Licencia SIL OFL 1.1 en ./fonts/PlusJakartaSans-OFL.txt.
const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin-wght-normal.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
});

// BL-524: íconos Material Symbols Outlined autoalojados, en lugar de la hoja
// de estilos de Google Fonts (sin SRI posible y con dominios externos en la
// CSP). Es una instancia estática con los valores que usa la app (FILL 0,
// wght 400, GRAD 0, opsz 24) y todos los íconos: ~390 KB, contra ~4 MB de la
// versión variable. Sale de material-symbols 0.49.0 (npm); licencia Apache
// 2.0 en ./fonts/MaterialSymbols-LICENSE.txt.
// - display "block": mientras carga, el ícono queda en blanco en lugar de
//   mostrar su nombre como texto («restaurant_menu»).
// - preload false: la usan sobre todo las pantallas del panel; así no se
//   descarga en el menú del comensal si no hace falta.
// - La clase .material-symbols-outlined está en globals.css y usa la
//   variable --font-material-symbols.
const materialSymbols = localFont({
  src: "./fonts/material-symbols-outlined.woff2",
  weight: "400",
  style: "normal",
  display: "block",
  preload: false,
  variable: "--font-material-symbols",
});

// BL-224: cada sección declara solo su nombre (`title: "Cocina"`) y la
// plantilla arma «Cocina · BistroLink». Sin título propio queda «BistroLink».
export const metadata: Metadata = {
  title: { default: "BistroLink", template: "%s · BistroLink" },
  description:
    "BistroLink conecta el menú digital de tu restaurante con la cocina y la caja. Pedí y pagá desde la mesa, sin esperas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={materialSymbols.variable}>
      <body className={`${plusJakarta.className} antialiased`}>
        {/* BL-214: errores del navegador en Grafana Cloud (Faro). */}
        <FrontendObservability />
        <KeycloakProvider>{children}</KeycloakProvider>
        <VersionInfo />
      </body>
    </html>
  );
}
