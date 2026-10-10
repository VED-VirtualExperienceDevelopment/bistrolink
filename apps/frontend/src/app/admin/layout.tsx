import type { Metadata } from 'next';
import AdminShell from '@/components/admin/AdminShell';

// BL-224: layout de servidor solo para declarar el título de la pestaña
// («Administración · BistroLink»). El guard de roles y el sidebar están en
// AdminShell, que es de cliente.
export const metadata: Metadata = {
  title: 'Administración',
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AdminShell>{children}</AdminShell>;
}
