import { Module } from '@nestjs/common';
import { TenantEstadoService } from './tenant-estado.service';

/**
 * BL-413: estado del establecimiento (activo o suspendido) con su caché.
 *
 * Lo importan AuthModule, PedidosModule, MenuModule, AuthComensalModule y
 * PlataformaModule. Nest crea un módulo una sola vez, así que todos usan la
 * misma instancia del servicio y la misma caché: cuando la plataforma
 * suspende, el próximo request de ese tenant ya ve el cambio.
 */
@Module({
  providers: [TenantEstadoService],
  exports: [TenantEstadoService],
})
export class TenantEstadoModule {}
