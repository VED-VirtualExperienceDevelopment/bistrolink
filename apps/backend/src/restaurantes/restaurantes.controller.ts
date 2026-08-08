import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { RestaurantesService } from './restaurantes.service';

/**
 * Hoy solo lo consume la pantalla de gestión de usuarios (HU-013 frontend)
 * para resolver el restauranteId requerido por CreateUsuarioDto — de ahí
 * que quede restringido a ADMIN, igual que /usuarios. Si en el futuro otra
 * pantalla no-admin necesita listar restaurantes, revisar si corresponde
 * relajar este guard en vez de reusar el mismo endpoint.
 */
@Controller('restaurantes')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class RestaurantesController {
  constructor(private readonly restaurantesService: RestaurantesService) {}

  @Get()
  listar(@Req() req: { user: AuthenticatedUser }) {
    return this.restaurantesService.listar(req.user.tenantId);
  }
}
