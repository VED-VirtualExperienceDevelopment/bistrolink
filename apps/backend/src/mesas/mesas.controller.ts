import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { MesaThrottlerGuard } from './mesa-throttler.guard';
import { MesasService } from './mesas.service';

@Controller('mesas')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('COMENSAL')
export class MesasController {
  constructor(private readonly mesasService: MesasService) {}

  @Post(':id/llamar')
  @UseGuards(MesaThrottlerGuard)
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  llamar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', ParseUUIDPipe) mesaId: string,
  ) {
    return this.mesasService.llamarMozo(req.user.tenantId, mesaId);
  }
}
