import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { KeycloakJwtStrategy } from './keycloak-jwt.strategy';
import { PlataformaJwtStrategy } from './plataforma-jwt.strategy';
import { InvitadoJwtStrategy } from './invitado-jwt.strategy';
import { RolesGuard } from './roles.guard';
import { TenantEstadoModule } from '../tenant-estado/tenant-estado.module';

@Module({
  // BL-413: TenantEstadoModule, para que la estrategia de tenant rechace
  // los tokens de un establecimiento suspendido.
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TenantEstadoModule,
  ],
  // PlataformaJwtStrategy (BL-163): estrategia 'jwt-plataforma', solo para
  // /plataforma/*. La estrategia por defecto sigue siendo la de tenant.
  providers: [
    KeycloakJwtStrategy,
    PlataformaJwtStrategy,
    // HU-052 (BL-578): token de invitado del comensal ('jwt-invitado').
    InvitadoJwtStrategy,
    RolesGuard,
  ],
  exports: [PassportModule, RolesGuard],
})
export class AuthModule {}
