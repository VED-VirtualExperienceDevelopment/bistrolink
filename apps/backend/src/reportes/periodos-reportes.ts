import { BadRequestException } from '@nestjs/common';
import { PedidoCanal } from '@prisma/client';
import { CanalReporte, PeriodoReporte } from './dto/filtros-reportes.dto';

/** HU-012 (BL-108): un período personalizado puede abarcar hasta un año. */
export const MAXIMO_DIAS_PERSONALIZADO = 366;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * HU-012 (BL-108): qué canales del pedido entran en cada filtro (D1).
 * En el local: los pedidos del QR de la mesa y los que carga el mozo. Fuera
 * del local: Web (pedidos para retirar) y WhatsApp (todavía sin pedidos).
 * TODOS no filtra: también suma VOZ, que hoy no se usa.
 */
export const CANALES_DEL_FILTRO: Record<
  Exclude<CanalReporte, 'TODOS'>,
  readonly PedidoCanal[]
> = {
  LOCAL: [PedidoCanal.QR, PedidoCanal.MOZO],
  WEB: [PedidoCanal.WEB],
  WHATSAPP: [PedidoCanal.WHATSAPP],
};

/** Los canales del pedido de un filtro, o null si no filtra (TODOS). */
export function canalesDelFiltro(
  canal: CanalReporte,
): readonly PedidoCanal[] | null {
  return canal === 'TODOS' ? null : CANALES_DEL_FILTRO[canal];
}

/** La rotación de mesas solo tiene sentido con ventas en el local. */
export function aplicaRotacion(canal: CanalReporte): boolean {
  return canal === 'TODOS' || canal === 'LOCAL';
}

/** Rango de días del calendario del local, ambos incluidos (AAAA-MM-DD). */
export interface RangoDias {
  desde: string;
  hasta: string;
}

/** El día del calendario (AAAA-MM-DD) de una fecha en una zona horaria. */
export function diaEnZona(fecha: Date, timezone: string): string {
  // en-CA da el formato AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

/** Suma (o resta) días a un día del calendario. */
export function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T00:00:00.000Z`);
  return new Date(fecha.getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Cuántos días abarca el rango, ambos incluidos. */
export function diasDelRango({ desde, hasta }: RangoDias): number {
  return (
    Math.round(
      (Date.parse(`${hasta}T00:00:00.000Z`) -
        Date.parse(`${desde}T00:00:00.000Z`)) /
        DIA_MS,
    ) + 1
  );
}

/** true si es un día que existe (descarta 2026-02-30). */
function diaValido(dia: string): boolean {
  const fecha = new Date(`${dia}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(dia);
}

/**
 * HU-012 (BL-108): el rango de días de un período, en el calendario del
 * local (D7). Un rango en el futuro es válido: no tiene ventas y el
 * dashboard queda vacío.
 */
export function resolverPeriodo(
  periodo: PeriodoReporte,
  timezone: string,
  ahora: Date,
  personalizado: Partial<RangoDias> = {},
): RangoDias {
  const hoy = diaEnZona(ahora, timezone);
  switch (periodo) {
    case 'HOY':
      return { desde: hoy, hasta: hoy };
    case 'AYER': {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case 'ULTIMOS_7_DIAS':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case 'MES_ACTUAL':
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    case 'PERSONALIZADO':
      return validarPersonalizado(personalizado);
  }
}

function validarPersonalizado({ desde, hasta }: Partial<RangoDias>): RangoDias {
  if (!desde || !hasta || !diaValido(desde) || !diaValido(hasta)) {
    throw new BadRequestException(
      'El período personalizado necesita fechas válidas en desde y hasta',
    );
  }
  if (desde > hasta) {
    throw new BadRequestException(
      'La fecha desde no puede ser posterior a la fecha hasta',
    );
  }
  if (diasDelRango({ desde, hasta }) > MAXIMO_DIAS_PERSONALIZADO) {
    throw new BadRequestException(
      `El período personalizado puede abarcar hasta ${MAXIMO_DIAS_PERSONALIZADO} días`,
    );
  }
  return { desde, hasta };
}

/**
 * El período inmediatamente anterior, de la misma cantidad de días: contra
 * él se compara (por ejemplo, hoy contra ayer).
 */
export function periodoAnterior(rango: RangoDias): RangoDias {
  const dias = diasDelRango(rango);
  return {
    desde: sumarDias(rango.desde, -dias),
    hasta: sumarDias(rango.desde, -1),
  };
}
