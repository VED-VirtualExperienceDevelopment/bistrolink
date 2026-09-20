import { esRolDeStaff, resolverDestinoLanding, type RolStaff } from '@/app/landing.utils';

/** Helper: simula hasRole() de Keycloak a partir de la lista de roles que "tiene" el usuario. */
function hasRoleDe(roles: RolStaff[]) {
  return (rol: RolStaff) => roles.includes(rol);
}

describe('resolverDestinoLanding', () => {
  it('ADMIN va a /admin/usuarios', () => {
    expect(resolverDestinoLanding(hasRoleDe(['ADMIN']))).toBe('/admin/usuarios');
  });

  it('MOZO va a /admin/mesas', () => {
    expect(resolverDestinoLanding(hasRoleDe(['MOZO']))).toBe('/admin/mesas');
  });

  it('COCINA va a /kds', () => {
    expect(resolverDestinoLanding(hasRoleDe(['COCINA']))).toBe('/kds');
  });

  it('sin ningún rol de staff, no hay destino (null)', () => {
    expect(resolverDestinoLanding(hasRoleDe([]))).toBeNull();
  });

  it('un rol ajeno a los 3 reconocidos tampoco tiene destino (null)', () => {
    // @ts-expect-error - a propósito: un rol que no es RolStaff (ej. de otro sistema) no matchea nada.
    expect(resolverDestinoLanding(hasRoleDe(['COMENSAL']))).toBeNull();
  });

  it('ADMIN gana sobre MOZO cuando el usuario tiene ambos roles', () => {
    expect(resolverDestinoLanding(hasRoleDe(['MOZO', 'ADMIN']))).toBe('/admin/usuarios');
  });

  it('ADMIN gana sobre COCINA cuando el usuario tiene ambos roles', () => {
    expect(resolverDestinoLanding(hasRoleDe(['COCINA', 'ADMIN']))).toBe('/admin/usuarios');
  });

  it('MOZO gana sobre COCINA cuando el usuario tiene ambos roles (y no ADMIN)', () => {
    expect(resolverDestinoLanding(hasRoleDe(['COCINA', 'MOZO']))).toBe('/admin/mesas');
  });

  it('con los 3 roles a la vez, sigue ganando ADMIN (prioridad completa)', () => {
    expect(resolverDestinoLanding(hasRoleDe(['COCINA', 'MOZO', 'ADMIN']))).toBe('/admin/usuarios');
  });
});

describe('esRolDeStaff', () => {
  it('true si tiene al menos uno de los 3 roles reconocidos', () => {
    expect(esRolDeStaff(hasRoleDe(['ADMIN']))).toBe(true);
    expect(esRolDeStaff(hasRoleDe(['MOZO']))).toBe(true);
    expect(esRolDeStaff(hasRoleDe(['COCINA']))).toBe(true);
  });

  it('false si no tiene ninguno (ej. solo COMENSAL, o ningún rol)', () => {
    expect(esRolDeStaff(hasRoleDe([]))).toBe(false);
  });
});