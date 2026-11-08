import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  armarFila,
  AuditLogService,
  separarAntesDespues,
  sinDatosSensibles,
} from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { conContextoAuditoria } from '../../src/audit-log/contexto-auditoria';
import { PrismaRuntimeClient } from '../../src/prisma/prisma-runtime.client';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ACTOR = '77777777-7777-4777-8777-777777777777';

// HU-035 (BL-205): el servicio además escribe en registro_auditoria.
function crearTx() {
  return {
    usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'usuario-1' }) },
    registroAuditoria: { create: jest.fn() },
    $executeRawUnsafe: jest.fn(),
  };
}

describe('AuditLogService', () => {
  let service: AuditLogService;
  let tx: ReturnType<typeof crearTx>;
  let prisma: { $transaction: jest.Mock };

  beforeEach(async () => {
    tx = crearTx();
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaRuntimeClient, useValue: prisma },
      ],
    }).compile();

    service = module.get(AuditLogService);
  });

  afterEach(() => jest.restoreAllMocks());

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

    it('[TC-U-035] AuditLogService.registrar incluye un message con la acción, que es el texto que muestran los logs de Railway (BL-273)', () => {
      const logSpy = jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);

      service.registrar({
        action: AuditAction.USUARIO_DESACTIVADO,
        tenantId: 'tenant-1',
        actorKeycloakId: 'kc-actor-1',
        targetUsuarioId: 'usuario-1',
        detalle: { rol: 'MOZO', sesionesCerradas: true },
      });

      const payload = logSpy.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.message).toBe(
        `Auditoría: ${AuditAction.USUARIO_DESACTIVADO}`,
      );
      expect(payload).toMatchObject({ rol: 'MOZO', sesionesCerradas: true });
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

  describe('HU-035 (BL-205): registro_auditoria', () => {
    const silenciar = () =>
      jest
        .spyOn((service as any).logger, 'log')
        .mockImplementation(() => undefined);

    it('registrar guarda la fila en una transacción propia, dentro del tenant', async () => {
      silenciar();

      service.registrar({
        action: AuditAction.USUARIO_ROL_MODIFICADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        targetUsuarioId: 'kc-afectado',
        detalle: { rolAnterior: 'MOZO', rolNuevo: 'ADMIN', rol: 'ADMIN' },
      });
      await new Promise((r) => setImmediate(r));

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        `SELECT set_config('app.tenant_id', $1, true)`,
        TENANT,
      );
      expect(tx.usuario.findUnique).toHaveBeenCalledWith({
        where: { keycloakId: ACTOR },
        select: { id: true },
      });
      expect(tx.registroAuditoria.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          actorKeycloakId: ACTOR,
          usuarioId: 'usuario-1',
          accion: 'USUARIO_ROL_MODIFICADO',
          entidad: 'usuario',
          entidadId: 'kc-afectado',
          valoresAntes: { rol: 'MOZO' },
          valoresDespues: { rol: 'ADMIN' },
          detalle: { rol: 'ADMIN' },
          ip: null,
        },
      });
    });

    it('si la base falla, registrar no lanza: deja un error en el log', async () => {
      silenciar();
      const error = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);
      prisma.$transaction.mockRejectedValue(new Error('base caída'));

      expect(() =>
        service.registrar({
          action: AuditAction.USUARIO_CREADO,
          tenantId: TENANT,
          actorKeycloakId: ACTOR,
        }),
      ).not.toThrow();
      await new Promise((r) => setImmediate(r));

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('No se pudo guardar en registro_auditoria'),
      );
    });

    it('registrarEnTx escribe en la transacción del llamador, con la IP de la request', async () => {
      silenciar();

      await conContextoAuditoria({ ip: '203.0.113.7' }, () =>
        service.registrarEnTx(tx as any, {
          action: AuditAction.CARTA_ITEM_MODIFICADO,
          tenantId: TENANT,
          actorKeycloakId: ACTOR,
          entidadId: 'item-1',
          antes: { precio: '12.50' },
          despues: { precio: '14.00' },
        }),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.registroAuditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          accion: 'CARTA_ITEM_MODIFICADO',
          entidad: 'item_carta',
          entidadId: 'item-1',
          valoresAntes: { precio: '12.50' },
          valoresDespues: { precio: '14.00' },
          detalle: Prisma.DbNull,
          ip: '203.0.113.7',
        }),
      });
    });

    it('un actor que no es un UUID (script, plataforma) se guarda sin buscar usuario', async () => {
      silenciar();

      await service.registrarEnTx(tx as any, {
        action: AuditAction.CARTA_ITEM_IMAGEN_CAMBIADA,
        tenantId: TENANT,
        actorKeycloakId: 'script:vero',
      });

      expect(tx.usuario.findUnique).not.toHaveBeenCalled();
      expect(tx.registroAuditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorKeycloakId: 'script:vero',
          usuarioId: null,
        }),
      });
    });

    it('el actor sin usuario en el tenant (plataforma) queda con usuarioId null', async () => {
      silenciar();
      tx.usuario.findUnique.mockResolvedValue(null);

      await service.registrarEnTx(tx as any, {
        action: AuditAction.ESTABLECIMIENTO_SUSPENDIDO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
      });

      expect(tx.registroAuditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entidad: 'establecimiento',
          usuarioId: null,
        }),
      });
    });

    it('nunca guarda ni loguea contraseñas, secretos, tokens ni datos de tarjeta', async () => {
      const log = silenciar();

      await service.registrarEnTx(tx as any, {
        action: AuditAction.USUARIO_CONTRASENA_RESTABLECIDA,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        detalle: {
          temporaryPassword: 'Abc123!',
          rol: 'MOZO',
          datos: { cardNumber: '5031', clientSecret: 'x' },
        },
      });

      const fila = tx.registroAuditoria.create.mock.calls[0][0].data;
      expect(fila.detalle).toEqual({
        temporaryPassword: '[oculto]',
        rol: 'MOZO',
        datos: { cardNumber: '[oculto]', clientSecret: '[oculto]' },
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('Abc123!');
    });
  });

  describe('funciones de apoyo', () => {
    it('sinDatosSensibles convierte decimales y fechas, y recorre listas', () => {
      expect(
        sinDatosSensibles({
          precio: new Prisma.Decimal('590.5'),
          fecha: new Date('2026-10-27T12:00:00.000Z'),
          lista: [{ token: 't' }, 3],
        }),
      ).toEqual({
        precio: '590.5',
        fecha: '2026-10-27T12:00:00.000Z',
        lista: [{ token: '[oculto]' }, 3],
      });
    });

    it('separarAntesDespues reconoce *Anterior, *Nuevo y *Nueva', () => {
      expect(
        separarAntesDespues({
          rolAnterior: 'MOZO',
          rolNuevo: 'ADMIN',
          imagenKeyAnterior: null,
          imagenKeyNueva: 'k',
          sesionesCerradas: 2,
        }),
      ).toEqual({
        antes: { rol: 'MOZO', imagenKey: null },
        despues: { rol: 'ADMIN', imagenKey: 'k' },
        resto: { sesionesCerradas: 2 },
      });
      expect(separarAntesDespues()).toEqual({
        antes: {},
        despues: {},
        resto: {},
      });
    });

    it('armarFila usa la entidad indicada, o «otra» si la acción no tiene prefijo conocido', () => {
      expect(
        armarFila({
          action: 'ALGO_NUEVO' as AuditAction,
          tenantId: TENANT,
          actorKeycloakId: ACTOR,
        }),
      ).toMatchObject({ entidad: 'otra', entidadId: null });
      expect(
        armarFila({
          action: AuditAction.MESA_PEDIDOS_CANCELADOS,
          tenantId: TENANT,
          actorKeycloakId: ACTOR,
          entidad: 'mesa',
          entidadId: 'mesa-1',
        }),
      ).toMatchObject({ entidad: 'mesa', entidadId: 'mesa-1' });
    });
  });
});
