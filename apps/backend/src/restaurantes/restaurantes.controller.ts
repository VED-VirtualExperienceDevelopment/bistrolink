import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { RestaurantesService } from './restaurantes.service';

/**
 * Originalmente ADMIN-only (solo lo consumía la gestión de usuarios, HU-013,
 * para resolver el restauranteId de CreateUsuarioDto). BL-160 sumó un
 * segundo consumidor no-admin: /admin/mesas necesita resolver el mismo
 * restauranteId para un Mozo en modo solo lectura, así que — tal como
 * anticipaba este mismo comentario — se relaja a ADMIN|MOZO en vez de
 * duplicar el endpoint. Sigue sin ser accesible a comensales ni a otros
 * tenants (AuthGuard('jwt') + tenantId del request).
 */
@Controller('restaurantes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN', 'MOZO')
export class RestaurantesController {
  constructor(private readonly restaurantesService: RestaurantesService) {}

  @Get()
  listar(@Req() req: { user: AuthenticatedUser }) {
    return this.restaurantesService.listar(req.user.tenantId);
  }
}
