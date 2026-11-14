import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Length } from 'class-validator';

/**
 * HU-040 (BL-210): reglas del pedido para retirar por el enlace web.
 *
 * - El local lo habilita o no, y define una franja diaria (HH:MM, en su zona
 *   horaria). Sin franja, se aceptan pedidos todo el día. Si «desde» es
 *   mayor que «hasta», la franja cruza la medianoche (por ejemplo, 19:00 a
 *   01:00).
 * - Al aprobarse el pago, el pedido recibe un código corto (R-001 a R-999,
 *   después vuelve a empezar) que el comensal muestra al retirar.
 * - El nombre y el contacto son opcionales y solo se guardan si el
 *   comensal aceptó el aviso de privacidad (HU-036, minimización).
 */

/** Código del error 409 cuando el local no toma pedidos para retirar. */
export const CODIGO_RETIRO_NO_DISPONIBLE = 'RETIRO_NO_DISPONIBLE';

export const HORA_HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Cuántos códigos hay antes de volver a empezar (R-001 … R-999). */
export const CODIGOS_DE_RETIRO = 999;

export interface ConfiguracionRetiro {
  retiroHabilitado: boolean;
  retiroHoraDesde: string | null;
  retiroHoraHasta: string | null;
}

/** Lo que ve el comensal en la carta del enlace web. */
export interface RetiroPublico {
  habilitado: boolean;
  /** Ahora mismo se pueden hacer pedidos para retirar. */
  abierto: boolean;
  horaDesde: string | null;
  horaHasta: string | null;
}

/** «HH:MM» de `ahora` en la zona horaria del local. */
export function horaLocal(ahora: Date, zonaHoraria: string): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: zonaHoraria,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (tipo: string) =>
    partes.find((p) => p.type === tipo)?.value ?? '00';
  return `${valor('hour')}:${valor('minute')}`;
}

/** Si `hora` está dentro de la franja (desde incluido, hasta excluido). */
export function dentroDeLaFranja(
  hora: string,
  desde: string,
  hasta: string,
): boolean {
  return desde < hasta
    ? hora >= desde && hora < hasta
    : hora >= desde || hora < hasta;
}

/** Si ahora el local toma pedidos para retirar. */
export function retiroAbierto(
  config: ConfiguracionRetiro,
  ahora: Date,
  zonaHoraria: string,
): boolean {
  if (!config.retiroHabilitado) return false;
  if (!config.retiroHoraDesde || !config.retiroHoraHasta) return true;
  return dentroDeLaFranja(
    horaLocal(ahora, zonaHoraria),
    config.retiroHoraDesde,
    config.retiroHoraHasta,
  );
}

export function retiroPublico(
  config: ConfiguracionRetiro,
  ahora: Date,
  zonaHoraria: string,
): RetiroPublico {
  return {
    habilitado: config.retiroHabilitado,
    abierto: retiroAbierto(config, ahora, zonaHoraria),
    horaDesde: config.retiroHoraDesde,
    horaHasta: config.retiroHoraHasta,
  };
}

/** Mensaje del 409 para el comensal. */
export function mensajeRetiroNoDisponible(config: ConfiguracionRetiro): string {
  if (!config.retiroHabilitado) {
    return 'Este local no está tomando pedidos para retirar.';
  }
  return `Este local toma pedidos para retirar de ${config.retiroHoraDesde} a ${config.retiroHoraHasta}.`;
}

/** 42 → «R-042». */
export function formatearCodigoRetiro(numero: number): string {
  return `R-${String(numero).padStart(3, '0')}`;
}

/**
 * Lo que escribe el colaborador al entregar, normalizado: «r42», «R 042»,
 * «42» y «R-042» son «R-042». Null si no es un código posible.
 */
export function normalizarCodigoRetiro(texto: string): string | null {
  const limpio = texto
    .trim()
    .toUpperCase()
    .replace(/^R[\s-]*/, '');
  if (!/^\d{1,3}$/.test(limpio)) return null;
  const numero = Number(limpio);
  if (numero < 1 || numero > CODIGOS_DE_RETIRO) return null;
  return formatearCodigoRetiro(numero);
}

/**
 * El contacto, normalizado para guardarlo y para buscarlo al anonimizar:
 * un correo en minúsculas; un teléfono solo con dígitos (y el + inicial).
 */
export function normalizarContactoRetiro(contacto: string): string {
  const limpio = contacto.trim();
  if (limpio.includes('@')) return limpio.toLowerCase();
  const signo = limpio.startsWith('+') ? '+' : '';
  return signo + limpio.replaceAll(/\D/g, '');
}

const limpiarEspacios = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().replaceAll(/\s+/g, ' ') : value;

/**
 * Nombre y contacto del pedido para retirar (POST /pedidos, solo en el
 * enlace web). El DTO controla tipos y largos; si el comensal no aceptó el
 * aviso de privacidad, no se guarda nada (el pedido sigue con el código).
 */
export class ContactoRetiroDto {
  @Transform(limpiarEspacios)
  @IsString({ message: 'El nombre debe ser texto' })
  @Length(1, 60, { message: 'El nombre debe tener entre 1 y 60 caracteres' })
  nombre: string;

  /** Un teléfono o un correo, para que el local avise si hace falta. */
  @Transform(limpiarEspacios)
  @IsString({ message: 'El contacto debe ser texto' })
  @Length(3, 100, {
    message: 'El contacto debe tener entre 3 y 100 caracteres',
  })
  contacto: string;

  /** HU-036 (BL-206): aceptó el aviso de privacidad. Sin aceptarlo no se guarda. */
  @IsBoolean({ message: 'consentimiento debe ser verdadero o falso' })
  consentimiento: boolean;
}

export interface ContactoRetiroEnPedido {
  retiroNombre: string | null;
  retiroContacto: string | null;
  retiroConsentidoEn: Date | null;
}

/** Qué guardar en el pedido: nada sin consentimiento o sin contacto válido. */
export function contactoRetiroParaGuardar(
  dto: ContactoRetiroDto | undefined,
  ahora: Date,
): ContactoRetiroEnPedido {
  const contacto = dto ? normalizarContactoRetiro(dto.contacto) : '';
  if (dto?.consentimiento !== true || contacto.replace('+', '').length < 3) {
    return {
      retiroNombre: null,
      retiroContacto: null,
      retiroConsentidoEn: null,
    };
  }
  return {
    retiroNombre: dto.nombre,
    retiroContacto: contacto,
    retiroConsentidoEn: ahora,
  };
}
