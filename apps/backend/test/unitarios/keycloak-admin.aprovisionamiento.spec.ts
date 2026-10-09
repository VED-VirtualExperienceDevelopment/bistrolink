import { InternalServerErrorException, Logger } from '@nestjs/common';
import { KeycloakAdminService } from '../../src/keycloak-admin/keycloak-admin.service';

/**
 * BL-163 (HU-027): métodos de KeycloakAdminService que usa el alta de
 * establecimientos y de usuarios de plataforma: findUserByUsername,
 * completarPerfil y las opciones nuevas de createUser (sin tenant_id,
 * requiredActions, contraseña permanente). La Admin API se simula con un
 * fetch falso; el primer pedido de cada llamada es siempre el token.
 */

interface Pedido {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function respuesta(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: (nombre: string) => headers[nombre] ?? null },
  };
}

describe('KeycloakAdminService: métodos del alta de establecimientos (BL-163)', () => {
  const service = new KeycloakAdminService();
  const secretoOriginal = process.env.KEYCLOAK_CLIENT_SECRET;
  let pedidos: Pedido[];
  let respuestasAdmin: ReturnType<typeof respuesta>[];

  beforeAll(() => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'secreto-de-prueba';
    // Los errores de la Admin API se loguean antes de lanzarse: acá no
    // interesa verlos en la salida de Jest.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    process.env.KEYCLOAK_CLIENT_SECRET = secretoOriginal;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    pedidos = [];
    respuestasAdmin = [];
    global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/protocol/openid-connect/token')) {
        return respuesta(200, { access_token: 'token-admin' });
      }
      pedidos.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const siguiente = respuestasAdmin.shift();
      if (!siguiente) throw new Error(`Pedido no esperado: ${url}`);
      return siguiente;
    }) as unknown as typeof fetch;
  });

  describe('findUserByUsername', () => {
    it('busca por username exacto y devuelve el usuario con sus atributos', async () => {
      respuestasAdmin.push(
        respuesta(200, [
          {
            id: 'kc-1',
            username: 'prueba-admin',
            attributes: { tenant_id: ['t-1'] },
          },
        ]),
      );

      const usuario = await service.findUserByUsername('prueba-admin');

      expect(usuario).toEqual(
        expect.objectContaining({ id: 'kc-1', username: 'prueba-admin' }),
      );
      expect(pedidos[0].url).toContain(
        '/users?username=prueba-admin&exact=true',
      );
    });

    it('codifica el username en la URL', async () => {
      respuestasAdmin.push(respuesta(200, []));

      await service.findUserByUsername('a&b=c');

      expect(pedidos[0].url).toContain('username=a%26b%3Dc&exact=true');
    });

    it('devuelve null si no existe', async () => {
      respuestasAdmin.push(respuesta(200, []));

      await expect(service.findUserByUsername('nadie')).resolves.toBeNull();
    });

    it('lanza un error interno si Keycloak responde con error', async () => {
      respuestasAdmin.push(respuesta(403, 'sin permiso'));

      await expect(service.findUserByUsername('prueba-admin')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('findUserById', () => {
    it('devuelve el usuario con su username', async () => {
      respuestasAdmin.push(
        respuesta(200, { id: 'kc-1', username: 'dev-daiana-plataforma' }),
      );

      await expect(service.findUserById('kc-1')).resolves.toEqual(
        expect.objectContaining({ username: 'dev-daiana-plataforma' }),
      );
      expect(pedidos[0].url).toMatch(/\/users\/kc-1$/);
    });

    it('devuelve null si no existe (404)', async () => {
      respuestasAdmin.push(respuesta(404, 'User not found'));

      await expect(service.findUserById('kc-x')).resolves.toBeNull();
    });

    it('lanza un error interno ante otro error de Keycloak', async () => {
      respuestasAdmin.push(respuesta(500, 'error'));

      await expect(service.findUserById('kc-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('createUser', () => {
    const creado = () =>
      respuesta(201, '', {
        Location: 'http://kc/admin/realms/bistrolink/users/kc-nuevo',
      });

    it('con tenantId: guarda tenant_id y el perfil; la contraseña es temporal por defecto', async () => {
      respuestasAdmin.push(creado());

      const id = await service.createUser({
        username: 'prueba-admin',
        email: 'admin@prueba.local',
        firstName: 'Admin',
        lastName: 'Prueba',
        tenantId: 't-1',
        temporaryPassword: 'Temporal-123',
      });

      expect(id).toBe('kc-nuevo');
      expect(pedidos[0].body).toEqual(
        expect.objectContaining({
          username: 'prueba-admin',
          firstName: 'Admin',
          lastName: 'Prueba',
          attributes: { tenant_id: ['t-1'] },
          credentials: [
            { type: 'password', value: 'Temporal-123', temporary: true },
          ],
        }),
      );
      expect(pedidos[0].body).not.toHaveProperty('requiredActions');
    });

    it('sin tenantId (usuario de plataforma): sin atributos, con requiredActions y contraseña permanente', async () => {
      respuestasAdmin.push(creado());

      await service.createUser({
        username: 'dev-daiana-plataforma',
        email: 'daiana@ejemplo.com',
        firstName: 'Daiana',
        lastName: 'Prueba',
        temporaryPassword: 'Permanente-123',
        temporary: false,
        requiredActions: ['CONFIGURE_TOTP'],
      });

      expect(pedidos[0].body).not.toHaveProperty('attributes');
      expect(pedidos[0].body).toEqual(
        expect.objectContaining({
          requiredActions: ['CONFIGURE_TOTP'],
          credentials: [
            { type: 'password', value: 'Permanente-123', temporary: false },
          ],
        }),
      );
    });
  });

  describe('completarPerfil', () => {
    const PERFIL = {
      email: 'admin@prueba.local',
      firstName: 'Admin',
      lastName: 'Prueba',
    };

    it('si no falta nada, no hace el PUT y devuelve false', async () => {
      respuestasAdmin.push(
        respuesta(200, { id: 'kc-1', username: 'u', ...PERFIL }),
      );

      await expect(service.completarPerfil('kc-1', PERFIL)).resolves.toBe(
        false,
      );
      expect(pedidos).toHaveLength(1);
    });

    it('manda el usuario entero con solo lo que faltaba, sin pisar lo que ya tenía', async () => {
      const existente = {
        id: 'kc-1',
        username: 'u',
        firstName: 'Nombre original',
        enabled: true,
        attributes: { tenant_id: ['t-1'] },
      };
      respuestasAdmin.push(respuesta(200, existente), respuesta(204));

      await expect(service.completarPerfil('kc-1', PERFIL)).resolves.toBe(true);

      expect(pedidos[1]).toEqual({
        url: expect.stringContaining('/users/kc-1'),
        method: 'PUT',
        body: {
          ...existente,
          email: PERFIL.email,
          lastName: PERFIL.lastName,
          emailVerified: true,
        },
      });
    });

    it('si el email ya estaba, no lo marca como verificado', async () => {
      respuestasAdmin.push(
        respuesta(200, { id: 'kc-1', username: 'u', email: 'otro@mail.com' }),
        respuesta(204),
      );

      await service.completarPerfil('kc-1', PERFIL);

      expect(pedidos[1].body).not.toHaveProperty('emailVerified');
      expect(pedidos[1].body?.email).toBe('otro@mail.com');
    });

    it('lanza un error interno si no puede leer el usuario', async () => {
      respuestasAdmin.push(respuesta(404, 'no existe'));

      await expect(service.completarPerfil('kc-1', PERFIL)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('lanza un error interno si Keycloak rechaza la actualización', async () => {
      respuestasAdmin.push(
        respuesta(200, { id: 'kc-1', username: 'u' }),
        respuesta(400, 'firstName inválido'),
      );

      await expect(service.completarPerfil('kc-1', PERFIL)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
