// src/audit-log/audit-log.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { AuditAction } from './audit-action.enum';

export interface AuditLogEntry {
  action: AuditAction;
  tenantId: string;
  /** sub del JWT del actor (Keycloak ID) — nunca el body del request. */
  actorKeycloakId: string;
  targetUsuarioId: string;
  detalle?: Record<string, unknown>;
}

/**
 * Servicio de auditoría para HU-013 (DoD [S]).
 *
 * Deliberadamente NO usa @InjectPinoLogger: este backend no inyecta
 * PinoLogger en ningún otro lado (ver usuarios.service.ts, que usa
 * `new Logger(UsuariosService.name)`). En su lugar usa el mismo
 * mecanismo — Logger de @nestjs/common — que ya queda enrutado a Pino
 * porque main.ts hace `app.useLogger(app.get(Logger))` con el Logger de
 * nestjs-pino (ver LoggerModule.forRoot en app.module.ts, con el
 * transport pino-loki). `.log()` en Nest mapea a nivel INFO en Pino,
 * que es justo lo que pide el DoD.
 *
 * El contexto 'Audit' permite filtrar en Grafana Loki con
 * `{app="bistrolink"} | json | context="Audit"` sin mezclarse con el
 * resto de los logs operativos.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('Audit');

  registrar(entry: AuditLogEntry): void {
    this.logger.log({
      audit: true,
      action: entry.action,
      tenantId: entry.tenantId,
      actorKeycloakId: entry.actorKeycloakId,
      targetUsuarioId: entry.targetUsuarioId,
      ...entry.detalle,
      timestamp: new Date().toISOString(),
    });
  }
}
