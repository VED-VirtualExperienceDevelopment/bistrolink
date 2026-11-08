import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlataformaModule } from './plataforma.module';
import { PlataformaController } from './plataforma.controller';

/**
 * BL-163 (HU-027), entrega 2: POST /plataforma/establecimientos.
 *
 * Separado de PlataformaModule para que los scripts no carguen el
 * controller: Nest crea sus guards al levantar el módulo, y
 * PlataformaThrottlerGuard necesita la configuración global de
 * ThrottlerModule, que registra MesasModule (el módulo es global). En la
 * aplicación siempre está; en un script, no.
 *
 * Lo importa AppModule.
 */
@Module({
  imports: [PlataformaModule, AuthModule],
  controllers: [PlataformaController],
})
export class PlataformaApiModule {}
