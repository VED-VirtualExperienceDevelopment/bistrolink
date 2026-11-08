import type { Metadata } from 'next';
import KdsShell from '@/components/kds/KdsShell';

// BL-224: layout de servidor solo para declarar el título de la pestaña
// («Cocina · BistroLink»). El guard de roles y el encabezado están en
// KdsShell, que es de cliente.
export const metadata: Metadata = {
  title: 'Cocina',
};

export default function KdsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <KdsShell>{children}</KdsShell>;
}
