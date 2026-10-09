import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

// validate() no usa el JWKS: se reemplaza jwks-rsa para no depender de su
// versión (las nuevas son ESM y Jest no las carga sin configuración extra).
jest.mock('jwks-rsa', () => ({
  passportJwtSecret: jest.fn(() => jest.fn()),
}));

import {
  KeycloakJwtStrategy,
  opcionesJwtKeycloak,
} from '../../src/auth/keycloak-jwt.strategy';
import { PlataformaJwtStrategy } from '../../src/auth/plataforma-jwt.strategy';

/**
 * BL-163 (HU-027): separación entre tokens de tenant y de plataforma.
 * - Un token PLATAFORMA no habilita ningún endpoint de tenant (401).
 * - Un token de tenant (ADMIN, MOZO, COCINA, COMENSAL) no habilita
 *   /plataforma/* (403).
 * La firma, el emisor y el vencimiento los valida passport-jwt antes de
 * validate(); acá se prueba solo qué token acepta cada estrategia.
 */

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

// Sin pasar por el constructor (no hace falta el JWKS de Keycloak para
// probar validate), mismo criterio que mesa-throttler.guard.spec.ts.
const estrategiaTenant = Object.create(
  KeycloakJwtStrategy.prototype,
) as KeycloakJwtStrategy;
const estrategiaPlataforma = Object.create(
  PlataformaJwtStrategy.prototype,
) as PlataformaJwtStrategy;

const token = (roles: string[], tenantId?: string) => ({
  sub: 'kc-usuario',
  ...(tenantId ? { tenant_id: tenantId } : {}),
  realm_access: { roles },
});

describe('KeycloakJwtStrategy: endpoints de tenant (BL-163)', () => {
  it.each(['ADMIN', 'MOZO', 'COCINA', 'COMENSAL'])(
    'acepta un token %s con tenant_id',
    async (rol) => {
      await expect(
        estrategiaTenant.validate(token([rol], TENANT_ID)),
      ).resolves.toEqual(
        expect.objectContaining({ sub: 'kc-usuario', tenantId: TENANT_ID }),
      );
    },
  );

  it('rechaza con 401 un token sin tenant_id (RD.07)', async () => {
    await expect(estrategiaTenant.validate(token(['ADMIN']))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('acepta un token sin realm_access (sin roles)', async () => {
    await expect(
      estrategiaTenant.validate({ sub: 'kc-usuario', tenant_id: TENANT_ID }),
    ).resolves.toEqual(expect.objectContaining({ roles: [] }));
  });

  it('rechaza con 401 un token PLATAFORMA', async () => {
    await expect(
      estrategiaTenant.validate(token(['PLATAFORMA'])),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza con 401 un token PLATAFORMA aunque traiga tenant_id', async () => {
    await expect(
      estrategiaTenant.validate(token(['PLATAFORMA', 'ADMIN'], TENANT_ID)),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('PlataformaJwtStrategy: endpoints /plataforma/* (BL-163)', () => {
  it('acepta un token PLATAFORMA sin tenant_id', () => {
    expect(estrategiaPlataforma.validate(token(['PLATAFORMA']))).toEqual({
      sub: 'kc-usuario',
      roles: ['PLATAFORMA'],
    });
  });

  it.each(['ADMIN', 'MOZO', 'COCINA', 'COMENSAL'])(
    'rechaza con 403 un token %s',
    (rol) => {
      expect(() =>
        estrategiaPlataforma.validate(token([rol], TENANT_ID)),
      ).toThrow(ForbiddenException);
    },
  );

  it('rechaza con 403 un token sin realm_access', () => {
    expect(() => estrategiaPlataforma.validate({ sub: 'kc-usuario' })).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza con 403 un token sin roles', () => {
    expect(() => estrategiaPlataforma.validate(token([]))).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza con 403 un token PLATAFORMA con tenant_id (configuración inválida)', () => {
    expect(() =>
      estrategiaPlataforma.validate(token(['PLATAFORMA'], TENANT_ID)),
    ).toThrow(ForbiddenException);
  });
});

describe('opcionesJwtKeycloak: validación compartida (BL-163)', () => {
  const opciones = opcionesJwtKeycloak();
  const extraer = (authorization?: string) =>
    opciones.jwtFromRequest({ headers: { authorization } } as never);

  it('toma el token del header Authorization: Bearer', () => {
    expect(extraer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it.each([undefined, 'Basic dXNlcjpwYXNz', 'abc.def.ghi'])(
    'no toma nada si el header es %p',
    (authorization) => {
      expect(extraer(authorization)).toBeNull();
    },
  );

  it('exige RS256 y no acepta tokens vencidos', () => {
    expect(opciones.algorithms).toEqual(['RS256']);
    expect(opciones.ignoreExpiration).toBe(false);
  });

  it('las dos estrategias se construyen con esa misma validación', () => {
    expect(new KeycloakJwtStrategy()).toBeInstanceOf(KeycloakJwtStrategy);
    expect(new PlataformaJwtStrategy()).toBeInstanceOf(PlataformaJwtStrategy);
  });
});
