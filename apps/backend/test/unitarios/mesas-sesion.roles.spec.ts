import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/auth/roles.guard';
import { MesasController } from '../../src/mesas/mesas.controller';

// HU-017 (BL-60, seguridad en BL-62): solo el mozo y el administrador
// abren, cierran y marcan limpia la mesa. Cocina y el comensal reciben 403.
// El controller declara @Roles('COMENSAL') a nivel de clase: este test
// confirma que el @Roles de cada método lo pisa (getAllAndOverride).

type Accion = 'abrirSesion' | 'cerrarSesion' | 'marcarLimpia';
const ACCIONES: Accion[] = ['abrirSesion', 'cerrarSesion', 'marcarLimpia'];

function contexto(accion: Accion, roles: string[]): ExecutionContext {
  return {
    getHandler: () => MesasController.prototype[accion],
    getClass: () => MesasController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { roles } }),
    }),
  } as unknown as ExecutionContext;
}

describe('HU-017 (BL-62): roles para abrir, cerrar y marcar limpia la mesa', () => {
  const guard = new RolesGuard(new Reflector());

  describe.each(ACCIONES)('%s', (accion) => {
    it.each([['MOZO'], ['ADMIN']])('%s puede', (rol) => {
      expect(guard.canActivate(contexto(accion, [rol]))).toBe(true);
    });

    it.each([['COCINA'], ['COMENSAL'], ['PLATAFORMA']])(
      '%s recibe 403',
      (rol) => {
        expect(() => guard.canActivate(contexto(accion, [rol]))).toThrow(
          ForbiddenException,
        );
      },
    );
  });
});
