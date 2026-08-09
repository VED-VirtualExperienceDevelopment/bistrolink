import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogService],
    }).compile();

    service = module.get(AuditLogService);
  });

  describe('registrar', () => {
    it('[TC-U-022] AuditLogService.registrar llama a logger.log con el shape esperado y todos los campos de la entrada', () => {
      // Espiamos el logger real (@nestjs/common Logger) en vez de mockear
      // AuditLogService entero — así esta suite SÍ ejercita el código real
      // de registrar(), a diferencia de usuarios.service.spec.ts, que
      // mockea el servicio completo para testear UsuariosService en
      // aislamiento.
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);

      service.registrar({
        action: AuditAction.USUARIO_ROL_MODIFICADO,
        tenantId: 'tenant-1',
        actorKeycloakId: 'kc-actor-1',
        targetUsuarioId: 'usuario-1',
        detalle: { rolAnterior: 'MOZO', rolNuevo: 'ADMIN' },
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const payload = logSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toMatchObject({
        audit: true,
        action: AuditAction.USUARIO_ROL_MODIFICADO,
        tenantId: 'tenant-1',
        actorKeycloakId: 'kc-actor-1',
        targetUsuarioId: 'usuario-1',
        rolAnterior: 'MOZO',
        rolNuevo: 'ADMIN',
      });
    });

    it('[TC-U-023] AuditLogService.registrar incluye un timestamp ISO 8601 en cada entrada', () => {
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);

      service.registrar({
        action: AuditAction.USUARIO_CREADO,
        tenantId: 'tenant-1',
        actorKeycloakId: 'kc-actor-1',
        targetUsuarioId: 'usuario-nuevo',
      });

      const payload = logSpy.mock.calls[0][0] as Record<string, unknown>;
      // No fijamos una fecha exacta (dependería del reloj de la corrida) —
      // solo confirmamos el formato ISO 8601, que es lo que Grafana Loki
      // necesita para ordenar/graficar los eventos correctamente.
      expect(payload.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it('[TC-U-024] AuditLogService.registrar funciona sin `detalle` (campo opcional)', () => {
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);

      expect(() =>
        service.registrar({
          action: AuditAction.USUARIO_DESACTIVACION_RECHAZADA,
          tenantId: 'tenant-1',
          actorKeycloakId: 'kc-actor-1',
          targetUsuarioId: 'usuario-1',
        }),
      ).not.toThrow();

      const payload = logSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.action).toBe(AuditAction.USUARIO_DESACTIVACION_RECHAZADA);
    });
  });
});
