import type { Metadata } from 'next';
import PlataformaShell from '@/components/plataforma/PlataformaShell';

// BL-224: layout de servidor solo para declarar el título de la pestaña
// («Plataforma · BistroLink»). El guard del rol PLATAFORMA y el encabezado
// están en PlataformaShell, que es de cliente.
export const metadata: Metadata = {
  title: 'Plataforma',
};

export default function PlataformaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PlataformaShell>{children}</PlataformaShell>;
}