import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { KeycloakJwtStrategy } from './keycloak-jwt.strategy';
import { PlataformaJwtStrategy } from './plataforma-jwt.strategy';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  // PlataformaJwtStrategy (BL-163): estrategia 'jwt-plataforma', solo para
  // /plataforma/*. La estrategia por defecto sigue siendo la de tenant.
  providers: [KeycloakJwtStrategy, PlataformaJwtStrategy, RolesGuard],
  exports: [PassportModule, RolesGuard],
})
export class AuthModule {}
