/**
 * BL-520: pantalla de Inicio del administrador y del mozo. Lógica pura
 * (probada en test/unitarios/inicio.utils.spec.ts).
 */
import type { EstadoMesa, MesaConLayout } from "@/types/mesa";
import type { Pedido } from "@/types/pedido";
import type { CategoriaCartaStaff } from "@/components/admin/pedido-mozo/pedido-mozo.utils";
import type { PlatoVendido } from "@/components/admin/reportes/reportes.utils";

export const RUTA_INICIO = "/admin/inicio";

/** Pedido listo que espera más que esto: se resalta. */
export const MINUTOS_LISTO_DEMORADO = 5;

/** Cuántas filas muestra cada tarjeta antes de «Ver todos». */
export const FILAS_POR_TARJETA = 3;

const ZONA_LOCAL = "America/Montevideo";

const FORMATO_HORA_DEL_DIA = new Intl.DateTimeFormat("es-UY", {
  timeZone: ZONA_LOCAL,
  hour: "numeric",
  hourCycle: "h23",
});

const FORMATO_FECHA = new Intl.DateTimeFormat("es-UY", {
  timeZone: ZONA_LOCAL,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Hora del día (0 a 23) en Uruguay, sin depender de la zona del navegador. */
export function horaEnUruguay(ahora: Date): number {
  return Number(FORMATO_HORA_DEL_DIA.format(ahora)) % 24;
}

/** «Buen día» de 6 a 12, «Buenas tardes» de 12 a 20 y «Buenas noches» el resto. */
export function saludoSegunHora(ahora: Date): string {
  const hora = horaEnUruguay(ahora);
  if (hora >= 6 && hora < 12) return "Buen día";
  if (hora >= 12 && hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** «Martes 10 de noviembre». */
export function fechaLarga(ahora: Date): string {
  const texto = FORMATO_FECHA.format(ahora).replace(",", "");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** «Ana María Pérez» → «Ana». Sin nombre, null (el saludo va sin nombre). */
export function primerNombre(nombre: string | undefined): string | null {
  const limpio = nombre?.trim();
  if (!limpio) return null;
  return limpio.split(/\s+/)[0];
}

/** «Buenas noches, Ana» o «Buenas noches» si no hay nombre. */
export function saludo(ahora: Date, nombre: string | undefined): string {
  const quien = primerNombre(nombre);
  const base = saludoSegunHora(ahora);
  return quien ? `${base}, ${quien}` : base;
}

export interface ResumenSalon {
  libres: number;
  ocupadas: number;
  pagando: number;
  paraLimpiar: number;
  total: number;
}

const CLAVE_DEL_ESTADO: Record<EstadoMesa, keyof Omit<ResumenSalon, "total">> =
  {
    LIBRE: "libres",
    OCUPADA: "ocupadas",
    EN_PROCESO_DE_PAGO: "pagando",
    REQUIERE_LIMPIEZA: "paraLimpiar",
  };

/** Cuántas mesas hay en cada estado. */
export function resumenSalon(
  mesas: readonly Pick<MesaConLayout, "estado">[],
): ResumenSalon {
  const resumen: ResumenSalon = {
    libres: 0,
    ocupadas: 0,
    pagando: 0,
    paraLimpiar: 0,
    total: mesas.length,
  };
  for (const mesa of mesas) {
    const clave = CLAVE_DEL_ESTADO[mesa.estado];
    if (clave) resumen[clave] += 1;
  }
  return resumen;
}

/** Mesas con gente: ocupadas o pagando. */
export function mesasConGente(resumen: ResumenSalon): number {
  return resumen.ocupadas + resumen.pagando;
}

/** Aplica un cambio de estado que llegó por el socket. */
export function cambiarEstadoMesa<
  T extends Pick<MesaConLayout, "id" | "estado">,
>(mesas: readonly T[], mesaId: string, estado: EstadoMesa): T[] {
  return mesas.map((m) => (m.id === mesaId ? { ...m, estado } : m));
}

export interface PedidoListo {
  id: string;
  /** null para un pedido para retirar (mesa virtual). */
  mesaNumero: number | null;
  platos: string;
  /** Desde cuándo está listo; si no se sabe, desde que se pidió. */
  desde: string;
}

/** La mesa virtual de los pedidos para retirar no tiene número (0). */
function numeroDeMesa(pedido: Pick<Pedido, "mesaNumero">): number | null {
  return pedido.mesaNumero > 0 ? pedido.mesaNumero : null;
}

/** «2 × Milanesa, 1 × Fritas». */
export function platosDelPedido(pedido: Pick<Pedido, "lineas">): string {
  return pedido.lineas
    .map((l) => `${l.cantidad} × ${l.nombreSnapshot}`)
    .join(", ");
}

/**
 * Pedidos listos para llevar a la mesa, el que más espera primero. `listoDesde`
 * tiene la hora en que pasó a listo, si llegó en vivo.
 */
export function pedidosListos(
  pedidos: readonly Pedido[],
  listoDesde: Readonly<Record<string, string>>,
): PedidoListo[] {
  return pedidos
    .filter((p) => p.estado === "LISTO_PARA_ENTREGAR")
    .map((p) => ({
      id: p.id,
      mesaNumero: numeroDeMesa(p),
      platos: platosDelPedido(p),
      desde: listoDesde[p.id] ?? p.createdAt,
    }))
    .sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde));
}

/** Pedidos que la cocina todavía no terminó. */
export function pedidosEnCocina(pedidos: readonly Pedido[]): number {
  return pedidos.filter(
    (p) => p.estado === "RECIBIDO" || p.estado === "EN_PREPARACION",
  ).length;
}

/** Minutos enteros desde `desde` (nunca negativos). */
export function minutosDesde(desde: string | number, ahora: number): number {
  const inicio = typeof desde === "number" ? desde : Date.parse(desde);
  if (Number.isNaN(inicio)) return 0;
  return Math.max(0, Math.floor((ahora - inicio) / 60_000));
}

/** «recién», «hace 1 min», «hace 12 min», «hace 1 h 5 min». */
export function textoHaceCuanto(minutos: number): string {
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `hace ${horas} h` : `hace ${horas} h ${resto} min`;
}

/** Nombres de los platos agotados de las categorías activas, sin repetir. */
export function platosAgotados(
  categorias: readonly CategoriaCartaStaff[],
): string[] {
  const nombres = new Set<string>();
  for (const categoria of categorias) {
    if (categoria.activo === false) continue;
    for (const item of categoria.items) {
      if (!item.disponible) nombres.add(item.nombre);
    }
  }
  return [...nombres].sort((a, b) => a.localeCompare(b, "es"));
}

/** Los platos más pedidos que entran en la tarjeta. */
export function topPlatos(
  platos: readonly PlatoVendido[],
  cantidad: number = FILAS_POR_TARJETA,
): PlatoVendido[] {
  return platos.slice(0, cantidad);
}

/** «1 alerta» / «3 alertas». */
export function contar(
  cantidad: number,
  singular: string,
  plural: string,
): string {
  return `${cantidad} ${cantidad === 1 ? singular : plural}`;
}
