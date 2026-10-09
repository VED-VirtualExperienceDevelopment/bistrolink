import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { MesaEstado, Prisma } from '@prisma/client';
import {
  AprovisionamientoService,
  CredencialesIniciales,
} from '../../src/plataforma/aprovisionamiento.service';
import { AprovisionarEstablecimientoDto } from '../../src/plataforma/dto/aprovisionar-establecimiento.dto';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';
import { AuditLogService } from '../../src/audit-log/audit-log.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

/**
 * BL-163 (HU-027), entrega 1: alta idempotente de un establecimiento con el
 * kit mínimo (tenant, restaurante, mesa virtual, Admin, Cocina y comensal).
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTRO_TENANT_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const RESTAURANTE_ID = 'cccccccc-3333-4333-8333-333333333333';
const MESA_VIRTUAL_ID = 'dddddddd-4444-4444-8444-444444444444';
const RUT = '219999999901';
// Alta desde el endpoint: solo el sub del token; el username se busca en Keycloak.
const ACTOR = { id: 'kc-plataforma-1' };
const COMENSAL_PASSWORD = 'comensal-de-prueba';

function dtoBase(
  overrides: Partial<AprovisionarEstablecimientoDto> = {},
): AprovisionarEstablecimientoDto {
  return {
    tenantId: TENANT_ID,
    razonSocial: 'Restaurante de Prueba SRL',
    rut: RUT,
    restaurante: {
      nombre: 'Restaurante de Prueba',
      direccion: 'Calle de Prueba 123',
    },
    admin: {
      username: 'prueba-admin',
      email: 'prueba-admin@prueba.bistrolink.local',
      nombre: 'Admin',
      apellido: 'De Prueba',
    },
    cocina: { username: 'prueba-cocina' },
    ...overrides,
  };
}

function crearErrorP2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '0.0.0',
  });
}

describe('AprovisionamientoService (BL-163)', () => {
  let service: AprovisionamientoService;
  let tx: any;
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let keycloakAdmin: jest.Mocked<
    Pick<
      KeycloakAdminService,
      | 'findUserByUsername'
      | 'createUser'
      | 'assignRealmRole'
      | 'deleteUser'
      | 'completarPerfil'
      | 'findUserById'
    >
  >;
  let auditLog: { registrar: jest.Mock };
  const passwordOriginal = process.env.KEYCLOAK_COMENSAL_PASSWORD;

  // Estado de la "base" de cada test: qué existe antes del alta.
  let tenantPorRut: { id: string } | null;
  let tenantPorId: { rut: string } | null;
  let restauranteExistente: { id: string } | null;

  beforeEach(async () => {
    process.env.KEYCLOAK_COMENSAL_PASSWORD = COMENSAL_PASSWORD;
    tenantPorRut = null;
    tenantPorId = null;
    restauranteExistente = null;

    tx = {
      tenant: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(where.rut ? tenantPorRut : tenantPorId),
        ),
        create: jest.fn().mockResolvedValue({}),
      },
      restaurante: {
        findUnique: jest.fn(() => Promise.resolve(restauranteExistente)),
        create: jest.fn().mockResolvedValue({ id: RESTAURANTE_ID }),
      },
      mesa: {
        upsert: jest
          .fn()
          .mockResolvedValue({ id: MESA_VIRTUAL_ID, esVirtual: true }),
      },
      usuario: {
        upsert: jest.fn().mockResolvedValue({ id: 'usuario-admin' }),
      },
    };

    tenantPrisma = {
      runInTenantContext: jest.fn((_tenantId: string, fn: any) => fn(tx)),
    };

    keycloakAdmin = {
      findUserByUsername: jest.fn().mockResolvedValue(null),
      createUser: jest.fn(async ({ username }) => `kc-${username}`),
      assignRealmRole: jest.fn().mockResolvedValue(undefined),
      deleteUser: jest.fn().mockResolvedValue(undefined),
      completarPerfil: jest.fn().mockResolvedValue(true),
      findUserById: jest.fn().mockResolvedValue({
        id: 'kc-plataforma-1',
        username: 'dev-daiana-plataforma',
      }),
    };

    auditLog = { registrar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AprovisionamientoService,
        { provide: TenantPrismaService, useValue: tenantPrisma },
        { provide: KeycloakAdminService, useValue: keycloakAdmin },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = await module.resolve(AprovisionamientoService);
  });

  afterAll(() => {
    process.env.KEYCLOAK_COMENSAL_PASSWORD = passwordOriginal;
  });

  const aprovisionar = (
    dto = dtoBase(),
    credenciales: CredencialesIniciales = {},
  ) => service.aprovisionar(dto, credenciales, ACTOR);

  describe('alta completa (nada existe)', () => {
    it('crea tenant, restaurante y mesa virtual dentro del contexto del tenant nuevo', async () => {
      const resultado = await aprovisionar();

      expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
        TENANT_ID,
        expect.any(Function),
      );
      expect(tx.tenant.create).toHaveBeenCalledWith({
        data: {
          id: TENANT_ID,
          razonSocial: 'Restaurante de Prueba SRL',
          rut: RUT,
          plan: 'BASICO',
          creadoPor: 'dev-daiana-plataforma',
        },
      });
      expect(tx.restaurante.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            timezone: 'America/Montevideo',
          }),
        }),
      );
      expect(tx.mesa.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            restauranteId_numero: { restauranteId: RESTAURANTE_ID, numero: 0 },
          },
          create: expect.objectContaining({
            numero: 0,
            esVirtual: true,
            estado: MesaEstado.LIBRE,
          }),
        }),
      );
      expect(resultado).toEqual(
        expect.objectContaining({
          tenantId: TENANT_ID,
          tenantCreado: true,
          restauranteId: RESTAURANTE_ID,
          restauranteCreado: true,
          mesaVirtualId: MESA_VIRTUAL_ID,
        }),
      );
    });

    it('crea Admin, Cocina y comensal técnico en Keycloak, con el tenant_id y el rol de cada uno', async () => {
      await aprovisionar();

      expect(keycloakAdmin.createUser).toHaveBeenCalledTimes(3);
      for (const username of [
        'prueba-admin',
        'prueba-cocina',
        `comensal-${TENANT_ID}`,
      ]) {
        expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
          expect.objectContaining({ username, tenantId: TENANT_ID }),
        );
      }
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-prueba-admin',
        'ADMIN',
      );
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-prueba-cocina',
        'COCINA',
      );
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        `kc-comensal-${TENANT_ID}`,
        'COMENSAL',
      );
    });

    it('crea los usuarios con el perfil completo que exige el realm (sin VERIFY_PROFILE en el primer login)', async () => {
      await aprovisionar();

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'prueba-admin',
          email: 'prueba-admin@prueba.bistrolink.local',
          firstName: 'Admin',
          lastName: 'De Prueba',
        }),
      );
      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'prueba-cocina',
          email: 'prueba-cocina@tecnico.bistrolink.local',
          firstName: 'Cocina',
          lastName: 'BistroLink',
        }),
      );
      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: `comensal-${TENANT_ID}`,
          email: `comensal-${TENANT_ID}@tecnico.bistrolink.local`,
          firstName: 'Comensal',
          lastName: 'BistroLink',
        }),
      );
    });

    it('la cuenta Cocina usa el email indicado si viene en los datos', async () => {
      await aprovisionar(
        dtoBase({
          cocina: { username: 'prueba-cocina', email: 'cocina@restaurante.uy' },
        }),
      );

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'prueba-cocina',
          email: 'cocina@restaurante.uy',
        }),
      );
    });

    it('el comensal técnico usa KEYCLOAK_COMENSAL_PASSWORD como contraseña permanente', async () => {
      await aprovisionar();

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: `comensal-${TENANT_ID}`,
          temporaryPassword: COMENSAL_PASSWORD,
          temporary: false,
        }),
      );
    });

    it('crea la fila de usuario solo para el Admin (Cocina no tiene fila, Anexo 6 §4.3)', async () => {
      await aprovisionar();

      expect(tx.usuario.upsert).toHaveBeenCalledTimes(1);
      expect(tx.usuario.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { keycloakId: 'kc-prueba-admin' },
          create: expect.objectContaining({
            tenantId: TENANT_ID,
            restauranteId: RESTAURANTE_ID,
            rol: 'ADMIN',
          }),
        }),
      );
    });

    it('con contraseña provista: la usa como permanente y no la devuelve', async () => {
      const resultado = await aprovisionar(dtoBase(), {
        admin: 'Admin-fija-123',
      });

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'prueba-admin',
          temporaryPassword: 'Admin-fija-123',
          temporary: false,
        }),
      );
      const admin = resultado.usuarios.find((u) => u.rol === 'ADMIN');
      expect(admin?.passwordGenerada).toBeUndefined();
    });

    it('sin contraseña provista: genera una temporal y la devuelve solo para ese usuario', async () => {
      const resultado = await aprovisionar(dtoBase(), {
        admin: 'Admin-fija-123',
      });

      const cocina = resultado.usuarios.find((u) => u.rol === 'COCINA');
      expect(cocina?.passwordGenerada).toEqual(expect.any(String));
      expect(cocina?.passwordGenerada?.length).toBeGreaterThanOrEqual(16);
      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'prueba-cocina',
          temporaryPassword: cocina?.passwordGenerada,
          temporary: true,
        }),
      );
      const comensal = resultado.usuarios.find((u) => u.rol === 'COMENSAL');
      expect(comensal?.passwordGenerada).toBeUndefined();
    });

    it('guarda como "creado por" el username de Keycloak del actor (alta desde el endpoint)', async () => {
      await aprovisionar();

      expect(keycloakAdmin.findUserById).toHaveBeenCalledWith(
        'kc-plataforma-1',
      );
      expect(tx.tenant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creadoPor: 'dev-daiana-plataforma' }),
      });
    });

    it('si el actor trae nombre (script), lo usa sin consultar Keycloak', async () => {
      await service.aprovisionar(
        dtoBase(),
        {},
        {
          id: 'script:daiana',
          nombre: 'script:daiana',
        },
      );

      expect(keycloakAdmin.findUserById).not.toHaveBeenCalled();
      expect(tx.tenant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creadoPor: 'script:daiana' }),
      });
    });

    it('si Keycloak no encuentra al actor, guarda su id', async () => {
      keycloakAdmin.findUserById.mockResolvedValue(null);

      await aprovisionar();

      expect(tx.tenant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ creadoPor: 'kc-plataforma-1' }),
      });
    });

    it('audita el alta sin usernames ni contraseñas', async () => {
      await aprovisionar();

      expect(auditLog.registrar).toHaveBeenCalledWith({
        action: AuditAction.ESTABLECIMIENTO_APROVISIONADO,
        tenantId: TENANT_ID,
        actorKeycloakId: 'kc-plataforma-1',
        targetUsuarioId: 'usuario-admin',
        detalle: {
          restauranteId: RESTAURANTE_ID,
          tenantCreado: true,
          restauranteCreado: true,
          usuariosCreados: ['ADMIN', 'COCINA', 'COMENSAL'],
        },
      });
      const registro = JSON.stringify(auditLog.registrar.mock.calls[0][0]);
      expect(registro).not.toContain('prueba-admin');
      expect(registro).not.toContain(COMENSAL_PASSWORD);
    });
  });

  describe('idempotencia', () => {
    beforeEach(() => {
      tenantPorRut = { id: TENANT_ID };
      tenantPorId = { rut: RUT };
      restauranteExistente = { id: RESTAURANTE_ID };
      keycloakAdmin.findUserByUsername.mockImplementation(async (username) => ({
        id: `kc-${username}`,
        username,
        email: `${username}@ya.existente`,
        firstName: 'Nombre',
        lastName: 'Apellido',
        attributes: { tenant_id: [TENANT_ID] },
      }));
    });

    it('si todo existe, no crea nada ni cambia contraseñas, y devuelve los mismos ids', async () => {
      const resultado = await aprovisionar(dtoBase(), {
        admin: 'otra-contraseña',
      });

      expect(tx.tenant.create).not.toHaveBeenCalled();
      expect(tx.restaurante.create).not.toHaveBeenCalled();
      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
      expect(resultado.tenantCreado).toBe(false);
      expect(resultado.restauranteCreado).toBe(false);
      expect(resultado.restauranteId).toBe(RESTAURANTE_ID);
      expect(resultado.usuarios.every((u) => !u.creado)).toBe(true);
      expect(resultado.usuarios.some((u) => u.passwordGenerada)).toBe(false);
    });

    it('si el perfil de los usuarios ya está completo, no lo toca', async () => {
      const resultado = await aprovisionar();

      expect(keycloakAdmin.completarPerfil).not.toHaveBeenCalled();
      expect(resultado.usuarios.every((u) => !u.perfilCompletado)).toBe(true);
    });

    it('completa el perfil de un usuario que ya existía sin email, nombre o apellido', async () => {
      keycloakAdmin.findUserByUsername.mockImplementation(async (username) => ({
        id: `kc-${username}`,
        username,
        attributes: { tenant_id: [TENANT_ID] },
      }));

      const resultado = await aprovisionar();

      expect(keycloakAdmin.completarPerfil).toHaveBeenCalledWith(
        'kc-prueba-admin',
        {
          email: 'prueba-admin@prueba.bistrolink.local',
          firstName: 'Admin',
          lastName: 'De Prueba',
        },
      );
      expect(keycloakAdmin.completarPerfil).toHaveBeenCalledWith(
        `kc-comensal-${TENANT_ID}`,
        expect.objectContaining({ firstName: 'Comensal' }),
      );
      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
      expect(resultado.usuarios.every((u) => u.perfilCompletado)).toBe(true);
      expect(resultado.usuarios.every((u) => !u.creado)).toBe(true);
    });

    it('vuelve a asignar los roles (completa un alta que se cortó después de crear el usuario)', async () => {
      await aprovisionar();

      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-prueba-admin',
        'ADMIN',
      );
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-prueba-cocina',
        'COCINA',
      );
    });

    it('la mesa virtual y la fila del Admin se aseguran con upsert (no se duplican)', async () => {
      await aprovisionar();

      expect(tx.mesa.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
      expect(tx.usuario.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });

    it('sin tenantId en los datos, encuentra el tenant existente por RUT', async () => {
      const sinTenantId = dtoBase();
      delete sinTenantId.tenantId;

      const resultado = await aprovisionar(sinTenantId);

      expect(resultado.tenantId).toBe(TENANT_ID);
      expect(tx.tenant.create).not.toHaveBeenCalled();
    });
  });

  describe('sin tenantId y con un RUT nuevo', () => {
    it('crea el tenant con un id nuevo y usa ese mismo id en todo el alta', async () => {
      const sinTenantId = dtoBase();
      delete sinTenantId.tenantId;

      const resultado = await aprovisionar(sinTenantId);

      expect(resultado.tenantId).toMatch(/^[0-9a-f-]{36}$/);
      expect(tx.tenant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: resultado.tenantId }),
      });
      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          username: `comensal-${resultado.tenantId}`,
          tenantId: resultado.tenantId,
        }),
      );
    });
  });

  describe('conflictos (no adopta datos de otro establecimiento)', () => {
    it('rechaza con 409 si el RUT ya pertenece a otro tenant, sin tocar Keycloak', async () => {
      tenantPorRut = { id: OTRO_TENANT_ID };

      await expect(aprovisionar()).rejects.toThrow(ConflictException);
      expect(tx.tenant.create).not.toHaveBeenCalled();
      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si el tenantId ya existe con otro RUT', async () => {
      tenantPorId = { rut: '210000000000' };

      await expect(aprovisionar()).rejects.toThrow(
        'El tenantId indicado ya existe con otro RUT',
      );
    });

    it('rechaza con 409 si el tenant ya tiene otro restaurante', async () => {
      tenantPorRut = { id: TENANT_ID };
      tenantPorId = { rut: RUT };
      restauranteExistente = { id: 'eeeeeeee-5555-4555-8555-555555555555' };

      await expect(
        aprovisionar(
          dtoBase({
            restaurante: {
              id: RESTAURANTE_ID,
              nombre: 'Otro',
              direccion: 'Otra',
            },
          }),
        ),
      ).rejects.toThrow('un tenant tiene un solo restaurante');
      expect(tx.restaurante.create).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si la mesa número 0 existe y no es virtual', async () => {
      tx.mesa.upsert.mockResolvedValue({ id: 'mesa-0', esVirtual: false });

      await expect(aprovisionar()).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
    });

    it('rechaza con 409 si un usuario de Keycloak con ese username es de otro tenant', async () => {
      keycloakAdmin.findUserByUsername.mockImplementation(async (username) =>
        username === 'prueba-admin'
          ? {
              id: 'kc-ajeno',
              username,
              attributes: { tenant_id: [OTRO_TENANT_ID] },
            }
          : null,
      );

      await expect(aprovisionar()).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.assignRealmRole).not.toHaveBeenCalledWith(
        'kc-ajeno',
        expect.anything(),
      );
    });

    it('rechaza con 409 un usuario existente sin tenant_id', async () => {
      keycloakAdmin.findUserByUsername.mockImplementation(async (username) =>
        username === 'prueba-admin' ? { id: 'kc-sin-tenant', username } : null,
      );

      await expect(aprovisionar()).rejects.toThrow(ConflictException);
    });

    it('traduce una violación de unicidad de la base (P2002) a 409', async () => {
      tx.restaurante.create.mockRejectedValue(crearErrorP2002());

      await expect(
        aprovisionar(
          dtoBase({
            restaurante: {
              id: RESTAURANTE_ID,
              nombre: 'R',
              direccion: 'D',
            },
          }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('repropaga los errores de base que no son de unicidad', async () => {
      tx.restaurante.create.mockRejectedValue(
        new Error('la base de datos no responde'),
      );

      await expect(aprovisionar()).rejects.toThrow(
        'la base de datos no responde',
      );
    });
  });

  describe('validaciones previas', () => {
    it('rechaza con 400 si Admin y Cocina tienen el mismo username, sin escribir nada', async () => {
      await expect(
        aprovisionar(dtoBase({ cocina: { username: 'prueba-admin' } })),
      ).rejects.toThrow(BadRequestException);
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });

    it('rechaza con 400 un username reservado para el comensal técnico', async () => {
      await expect(
        aprovisionar(
          dtoBase({ admin: { ...dtoBase().admin, username: 'comensal-algo' } }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('falla antes de escribir nada si falta KEYCLOAK_COMENSAL_PASSWORD', async () => {
      delete process.env.KEYCLOAK_COMENSAL_PASSWORD;

      await expect(aprovisionar()).rejects.toThrow(
        'Falta KEYCLOAK_COMENSAL_PASSWORD',
      );
      expect(tenantPrisma.runInTenantContext).not.toHaveBeenCalled();
      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
    });
  });

  describe('compensación en Keycloak', () => {
    it('si falla la asignación del rol de un usuario recién creado, lo borra y propaga el error', async () => {
      keycloakAdmin.assignRealmRole.mockImplementation(async (_id, rol) => {
        if (rol === 'COCINA') throw new Error('Keycloak no disponible');
      });

      await expect(aprovisionar()).rejects.toThrow('Keycloak no disponible');
      expect(keycloakAdmin.deleteUser).toHaveBeenCalledWith('kc-prueba-cocina');
      expect(keycloakAdmin.deleteUser).not.toHaveBeenCalledWith(
        'kc-prueba-admin',
      );
      expect(auditLog.registrar).not.toHaveBeenCalled();
    });

    it('no oculta el error original aunque la compensación también falle', async () => {
      keycloakAdmin.assignRealmRole.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );
      keycloakAdmin.deleteUser.mockRejectedValue(
        new Error('Keycloak tampoco responde'),
      );

      await expect(aprovisionar()).rejects.toThrow('Keycloak no disponible');
    });

    it('no borra un usuario que ya existía si falla la asignación de su rol', async () => {
      keycloakAdmin.findUserByUsername.mockImplementation(async (username) => ({
        id: `kc-${username}`,
        username,
        attributes: { tenant_id: [TENANT_ID] },
      }));
      keycloakAdmin.assignRealmRole.mockRejectedValue(
        new Error('Keycloak no disponible'),
      );

      await expect(aprovisionar()).rejects.toThrow('Keycloak no disponible');
      expect(keycloakAdmin.deleteUser).not.toHaveBeenCalled();
    });
  });
});
