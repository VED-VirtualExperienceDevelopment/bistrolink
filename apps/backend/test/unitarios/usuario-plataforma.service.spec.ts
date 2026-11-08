import { ConflictException, Logger } from '@nestjs/common';
import { UsuarioPlataformaService } from '../../src/plataforma/usuario-plataforma.service';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';
import { CrearUsuarioPlataformaDto } from '../../src/plataforma/dto/crear-usuario-plataforma.dto';

/** BL-163 (HU-027), entrega 2: alta del usuario de plataforma. */

const DTO: CrearUsuarioPlataformaDto = {
  username: 'dev-daiana-plataforma',
  email: 'daiana@ejemplo.com',
  nombre: 'Daiana',
  apellido: 'Prueba',
};

describe('UsuarioPlataformaService (BL-163)', () => {
  let keycloakAdmin: jest.Mocked<
    Pick<
      KeycloakAdminService,
      | 'findUserByUsername'
      | 'createUser'
      | 'assignRealmRole'
      | 'deleteUser'
      | 'completarPerfil'
    >
  >;
  let service: UsuarioPlataformaService;

  beforeEach(() => {
    keycloakAdmin = {
      findUserByUsername: jest.fn().mockResolvedValue(null),
      createUser: jest.fn().mockResolvedValue('kc-nuevo'),
      assignRealmRole: jest.fn().mockResolvedValue(undefined),
      deleteUser: jest.fn().mockResolvedValue(undefined),
      completarPerfil: jest.fn().mockResolvedValue(true),
    };
    service = new UsuarioPlataformaService(
      keycloakAdmin as unknown as KeycloakAdminService,
    );
  });

  describe('usuario nuevo', () => {
    it('lo crea sin tenant_id, con perfil completo, OTP obligatorio y rol PLATAFORMA', async () => {
      const resultado = await service.asegurar(DTO, 'Una-contraseña-1');

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith({
        username: 'dev-daiana-plataforma',
        email: 'daiana@ejemplo.com',
        firstName: 'Daiana',
        lastName: 'Prueba',
        temporaryPassword: 'Una-contraseña-1',
        temporary: false,
        requiredActions: ['CONFIGURE_TOTP'],
      });
      expect(keycloakAdmin.createUser.mock.calls[0][0]).not.toHaveProperty(
        'tenantId',
      );
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-nuevo',
        'PLATAFORMA',
      );
      expect(resultado).toEqual({ keycloakId: 'kc-nuevo', creado: true });
    });

    it('sin contraseña provista genera una temporal y la devuelve', async () => {
      const resultado = await service.asegurar(DTO);

      expect(resultado.passwordGenerada).toEqual(expect.any(String));
      expect(resultado.passwordGenerada!.length).toBeGreaterThanOrEqual(16);
      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          temporaryPassword: resultado.passwordGenerada,
          temporary: true,
        }),
      );
    });

    it('si falla la asignación del rol, borra el usuario recién creado y propaga el error', async () => {
      keycloakAdmin.assignRealmRole.mockRejectedValue(
        new Error('El rol PLATAFORMA no existe'),
      );

      await expect(service.asegurar(DTO)).rejects.toThrow(
        'El rol PLATAFORMA no existe',
      );
      expect(keycloakAdmin.deleteUser).toHaveBeenCalledWith('kc-nuevo');
    });

    it('no oculta el error original aunque la compensación también falle', async () => {
      keycloakAdmin.assignRealmRole.mockRejectedValue(
        new Error('El rol PLATAFORMA no existe'),
      );
      keycloakAdmin.deleteUser.mockRejectedValue(
        new Error('Keycloak no responde'),
      );
      const logError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(service.asegurar(DTO)).rejects.toThrow(
        'El rol PLATAFORMA no existe',
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('Requiere limpieza manual'),
        expect.anything(),
      );
      logError.mockRestore();
    });
  });

  describe('usuario existente', () => {
    it('no lo recrea ni le cambia la contraseña; le asegura el rol', async () => {
      keycloakAdmin.findUserByUsername.mockResolvedValue({
        id: 'kc-existente',
        username: DTO.username,
        email: DTO.email,
        firstName: 'Daiana',
        lastName: 'Prueba',
      });

      const resultado = await service.asegurar(DTO, 'otra-contraseña');

      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
      expect(keycloakAdmin.completarPerfil).not.toHaveBeenCalled();
      expect(keycloakAdmin.assignRealmRole).toHaveBeenCalledWith(
        'kc-existente',
        'PLATAFORMA',
      );
      expect(resultado).toEqual({
        keycloakId: 'kc-existente',
        creado: false,
        perfilCompletado: false,
      });
    });

    it('completa el perfil si le falta email, nombre o apellido', async () => {
      keycloakAdmin.findUserByUsername.mockResolvedValue({
        id: 'kc-existente',
        username: DTO.username,
      });

      const resultado = await service.asegurar(DTO);

      expect(keycloakAdmin.completarPerfil).toHaveBeenCalledWith(
        'kc-existente',
        { email: DTO.email, firstName: 'Daiana', lastName: 'Prueba' },
      );
      expect(resultado.perfilCompletado).toBe(true);
    });

    it('rechaza con 409 un usuario de un establecimiento (con tenant_id) sin darle el rol', async () => {
      keycloakAdmin.findUserByUsername.mockResolvedValue({
        id: 'kc-de-tenant',
        username: DTO.username,
        attributes: { tenant_id: ['11111111-1111-1111-1111-111111111111'] },
      });

      await expect(service.asegurar(DTO)).rejects.toThrow(ConflictException);
      expect(keycloakAdmin.assignRealmRole).not.toHaveBeenCalled();
    });
  });
});
