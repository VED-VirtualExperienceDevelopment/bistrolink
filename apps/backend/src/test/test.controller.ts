import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';

@Controller('test')
export class TestController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('mi-tenant')
  async miTenant(@Req() req: { user: AuthenticatedUser }) {
    return this.tenantPrisma.runInTenantContext(req.user.tenantId, (tx) =>
      tx.restaurante.findMany(),
    );
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('solo-admin')
  async soloAdmin(@Req() req: { user: AuthenticatedUser }) {
    return this.tenantPrisma.runInTenantContext(req.user.tenantId, (tx) =>
      tx.usuario.findMany(),
    );
  }
}
