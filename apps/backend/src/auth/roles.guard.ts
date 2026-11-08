import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from './keycloak-jwt.strategy';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;
    const autorizado = requiredRoles.some((r) => user.roles.includes(r));
    if (!autorizado) {
      // Ej.: JWT de rol Cocina contra un endpoint de administración → 403
      throw new ForbiddenException(
        `Rol requerido: ${requiredRoles.join(' o ')}`,
      );
    }
    return true;
  }
}
// Uso en un controller:
// @UseGuards(AuthGuard('jwt'), RolesGuard)
// @Roles('ADMIN')
// @Get('reportes')
// getReportes(@Req() req) { ... }
