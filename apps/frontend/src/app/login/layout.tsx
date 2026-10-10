import type { Metadata } from "next";

// BL-224: la página de login es de cliente y no puede exportar `metadata`;
// este layout de servidor solo declara el título («Ingresar · BistroLink»).
export const metadata: Metadata = {
  title: "Ingresar",
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
