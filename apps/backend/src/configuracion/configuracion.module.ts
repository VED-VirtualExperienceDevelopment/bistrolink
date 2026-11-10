import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionEstablecimientoService } from './configuracion-establecimiento.service';
import { AnonimizarReceptorService } from './anonimizar-receptor.service';
import { AnonimizarRetiroService } from './anonimizar-retiro.service';
import { PedidosModule } from '../pedidos/pedidos.module';

/**
 * HU-020 (BL-72): GET y PATCH /admin/configuracion, solo ADMIN.
 * HU-009 (BL-453): POST /admin/configuracion/privacidad/anonimizar-receptor.
 * HU-040 (BL-210): POST /admin/configuracion/privacidad/anonimizar-retiro.
 * HU-042 (BL-465): PedidosModule, para avisar al KDS los cambios de la cola.
 */
@Module({
  imports: [PrismaModule, PedidosModule],
  controllers: [ConfiguracionController],
  providers: [
    ConfiguracionEstablecimientoService,
    AnonimizarReceptorService,
    AnonimizarRetiroService,
    AuditLogService,
  ],
})
export class ConfiguracionModule {}
