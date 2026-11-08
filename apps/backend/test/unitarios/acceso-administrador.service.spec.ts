import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccesoAdministradorService } from '../../src/plataforma/acceso-administrador.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { UsuariosService } from '../../src/usuarios/usuarios.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

/**
 * BL-414: recuperar el acceso del Administrador de un establecimiento. La
 * base y UsuariosService se simulan: la lógica de Keycloak (contraseña
 * temporal, cierre de sesiones, compensación del alta) ya la prueba
 * usuarios.service.spec.ts.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const RESTAURANTE_ID = 'cccccccc-3333-4333-8333-333333333333';
const ADMIN_ID = 'dddddddd-4444-4444-8444-444444444444';
const ACTOR = { id: 'kc-plataforma-1' };

const NUEVO = {
  username: 'nuevo-admin',
  email: 'nuevo-admin@uno.local',
  nombre: 'Laura',
  apellido: 'Méndez',
};

describe('AccesoAdministradorService (BL-414)', () => {
  let contextos: string[];
  let tx: any;
  let usuarios: { restablecerContrasena: jest.Mock; crear: jest.Mock };
  let service: AccesoAdministradorService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID }) },
      restaurante: {
        findUnique: jest.fn().mockResolvedValue({ id: RESTAURANTE_ID }),
      },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    usuarios = {
      restablecerContrasena: jest.fn().mockResolvedValue({
        id: ADMIN_ID,
        temporaryPassword: 'temporal-16-chars',
        sesionesCerradas: true,
      }),
      crear: jest.fn().mockResolvedValue({
        id: 'usuario-nuevo',
        tenantId: TENANT_ID,
        keycloakId: 'kc-nuevo',
        restauranteId: RESTAURANTE_ID,
        rol: 'ADMIN',
        ...NUEVO,
        temporaryPassword: 'temporal-nueva-16',
      }),
    };
    service = new AccesoAdministradorService(
      tenantPrisma as unknown as TenantPrismaService,
      usuarios as unknown as UsuariosService,
    );
  });

  describe('restablecerContrasena', () => {
    it('[TC-U-148] restablece solo Administradores, en el contexto del tenant y con la auditoría de plataforma', async () => {
      const resultado = await service.restablecerContrasena(
        TENANT_ID,
        ADMIN_ID,
        ACTOR,
      );

      expect(contextos).toEqual([TENANT_ID]);
      expect(usuarios.restablecerContrasena).toHaveBeenCalledWith(
        TENANT_ID,
        ACTOR.id,
        ADMIN_ID,
        {
          accionAuditoria:
            AuditAction.ESTABLECIMIENTO_ADMIN_CONTRASENA_RESTABLECIDA,
          soloRol: 'ADMIN',
        },
      );
      expect(resultado).toEqual({
        id: ADMIN_ID,
        temporaryPassword: 'temporal-16-chars',
        sesionesCerradas: true,
      });
    });

    it('[TC-U-149] un establecimiento inexistente da 404 sin tocar Keycloak', async () => {
      tx.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.restablecerContrasena(TENANT_ID, ADMIN_ID, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(usuarios.restablecerContrasena).not.toHaveBeenCalled();
    });

    it('restablece aunque el establecimiento no tenga restaurante', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);

      await service.restablecerContrasena(TENANT_ID, ADMIN_ID, ACTOR);
      expect(usuarios.restablecerContrasena).toHaveBeenCalled();
    });
  });

  describe('crear', () => {
    it('[TC-U-150] crea un ADMIN del restaurante del establecimiento, con la auditoría de plataforma', async () => {
      await service.crear(TENANT_ID, NUEVO, ACTOR);

      expect(contextos).toEqual([TENANT_ID]);
      expect(usuarios.crear).toHaveBeenCalledWith(
        TENANT_ID,
        ACTOR.id,
        { ...NUEVO, rol: 'ADMIN', restauranteId: RESTAURANTE_ID },
        { accionAuditoria: AuditAction.ESTABLECIMIENTO_ADMIN_CREADO },
      );
    });

    it('[TC-U-151] devuelve la contraseña temporal sin keycloakId ni tenantId', async () => {
      const resultado = await service.crear(TENANT_ID, NUEVO, ACTOR);

      expect(resultado).toEqual({
        id: 'usuario-nuevo',
        ...NUEVO,
        temporaryPassword: 'temporal-nueva-16',
      });
      expect(resultado).not.toHaveProperty('keycloakId');
      expect(resultado).not.toHaveProperty('tenantId');
    });

    it('[TC-U-152] da 409 si el establecimiento no tiene restaurante y 404 si no existe, sin crear nada', async () => {
      tx.restaurante.findUnique.mockResolvedValue(null);
      await expect(service.crear(TENANT_ID, NUEVO, ACTOR)).rejects.toThrow(
        ConflictException,
      );

      tx.tenant.findUnique.mockResolvedValue(null);
      await expect(service.crear(TENANT_ID, NUEVO, ACTOR)).rejects.toThrow(
        NotFoundException,
      );

      expect(usuarios.crear).not.toHaveBeenCalled();
    });

    it('propaga el 409 de un usuario o correo que ya existe', async () => {
      usuarios.crear.mockRejectedValue(
        new ConflictException(
          'Ya existe un usuario con ese nombre de usuario o email',
        ),
      );

      await expect(service.crear(TENANT_ID, NUEVO, ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
