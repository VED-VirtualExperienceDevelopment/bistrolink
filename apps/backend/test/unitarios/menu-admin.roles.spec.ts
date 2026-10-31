import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/auth/roles.guard';
import { MenuAdminController } from '../../src/menu/menu-admin.controller';

// BL-395 y BL-394 (BL-392): la carta la gestiona el ADMIN. El MOZO solo la ve y marca
// ítems como agotados o disponibles. Cocina, el comensal y la plataforma no
// entran. El controller declara @Roles('ADMIN') a nivel de clase y los dos
// métodos del MOZO lo pisan con su propio @Roles (getAllAndOverride).

type Metodo = keyof MenuAdminController;

const DEL_MOZO: Metodo[] = ['findAllCategorias', 'cambiarDisponibilidad'];

const SOLO_ADMIN: Metodo[] = [
  'createCategoria',
  'updateCategoria',
  'archivarCategoria',
  'restaurarCategoria',
  'eliminarCategoria',
  'createItem',
  'updateItem',
  'archivarItem',
  'restaurarItem',
  'eliminarItem',
  'getPresignedUrl',
  'confirmarImagen',
];

const SIN_ACCESO = ['COCINA', 'COMENSAL', 'PLATAFORMA'];

function contexto(metodo: Metodo, roles: string[]): ExecutionContext {
  return {
    getHandler: () => MenuAdminController.prototype[metodo],
    getClass: () => MenuAdminController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles } }),
    }),
  } as unknown as ExecutionContext;
}

describe('BL-395: roles de Gestión de Carta', () => {
  const guard = new RolesGuard(new Reflector());

  describe.each(DEL_MOZO)('%s (ADMIN y MOZO)', (metodo) => {
    it.each([['ADMIN'], ['MOZO']])('[TC-U-175] %s puede', (rol) => {
      expect(guard.canActivate(contexto(metodo, [rol]))).toBe(true);
    });

    it.each(SIN_ACCESO.map((r) => [r]))('[TC-U-176] %s recibe 403', (rol) => {
      expect(() => guard.canActivate(contexto(metodo, [rol]))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe.each(SOLO_ADMIN)('%s (solo ADMIN)', (metodo) => {
    it('[TC-U-177] ADMIN puede', () => {
      expect(guard.canActivate(contexto(metodo, ['ADMIN']))).toBe(true);
    });

    it.each([['MOZO'], ...SIN_ACCESO.map((r) => [r])])(
      '[TC-U-178] %s recibe 403',
      (rol) => {
        expect(() => guard.canActivate(contexto(metodo, [rol]))).toThrow(
          ForbiddenException,
        );
      },
    );
  });
});
