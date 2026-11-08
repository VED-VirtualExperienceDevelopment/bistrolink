import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';

/**
 * HU-035 (BL-205): datos de la request que el registro de auditoría guarda
 * sin que cada servicio tenga que recibirlos por parámetro. Hoy, la IP.
 *
 * AsyncLocalStorage acompaña toda la cadena asíncrona de la request
 * (guards, controller, servicios, transacciones), así que AuditLogService la
 * lee donde sea que se llame. Fuera de una request (jobs, scripts) no hay
 * contexto y la IP queda en null.
 */
export interface ContextoAuditoria {
  ip: string | null;
}

const almacen = new AsyncLocalStorage<ContextoAuditoria>();

export function contextoAuditoria(): ContextoAuditoria | undefined {
  return almacen.getStore();
}

/** Para los tests: corre `fn` con un contexto dado. */
export function conContextoAuditoria<T>(
  contexto: ContextoAuditoria,
  fn: () => T,
): T {
  return almacen.run(contexto, fn);
}

const LARGO_IP = 45; // IPv6 con IPv4 embebida, la columna es VARCHAR(45)

interface RequestMinima {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/**
 * IP del cliente. En Railway la API está detrás de un proxy, que AGREGA la
 * IP real al final de X-Forwarded-For. Se toma la ÚLTIMA entrada (la que
 * puso el proxy), no la primera: la primera la puede inventar el cliente
 * mandando su propio header. Sin proxy (local), la del socket.
 *
 * No se activa `trust proxy` de Express a propósito: cambiaría `req.ip` para
 * toda la app (por ejemplo, los limitadores de pedidos por IP).
 */
export function ipDeLaRequest(req: RequestMinima): string | null {
  const reenviada = req.headers['x-forwarded-for'];
  const lista = Array.isArray(reenviada) ? reenviada.join(',') : reenviada;
  // La última no vacía. (findLast es de ES2023 y el backend compila a
  // ES2021: se recorre de atrás para adelante.)
  const ultima = lista
    ?.split(',')
    .map((ip) => ip.trim())
    .reverse()
    .find((ip) => ip.length > 0);
  const ip = ultima ?? req.socket?.remoteAddress ?? null;
  return ip ? ip.slice(0, LARGO_IP) : null;
}

@Injectable()
export class ContextoAuditoriaMiddleware implements NestMiddleware {
  use(req: RequestMinima, _res: unknown, next: () => void): void {
    almacen.run({ ip: ipDeLaRequest(req) }, next);
  }
}
