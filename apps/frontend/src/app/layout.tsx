import type { Metadata } from "next";
import localFont from "next/font/local";
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
    <html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${plusJakarta.className} antialiased`}
      >
        <KeycloakProvider>{children}</KeycloakProvider>
        <VersionInfo />
      </body>
    </html>
  );
}
