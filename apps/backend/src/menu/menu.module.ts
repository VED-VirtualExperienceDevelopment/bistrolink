import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { StorageService } from './storage.service';
import { MenuGateway } from './menu.gateway';
import { MenuAdminService } from './menu-admin.service';
import { MenuAdminController } from './menu-admin.controller';
import { ProcesadorImagenService } from './procesador-imagen.service';
import { ImagenesMenuService } from './imagenes-menu.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QrMesaModule } from '../qr-mesa/qr-mesa.module';
import { TenantEstadoModule } from '../tenant-estado/tenant-estado.module';
import { WsAuthService } from '../pedidos/ws-auth.service';

@Module({
  // BL-413: TenantEstadoModule, para el menú público de un establecimiento
  // suspendido y para WsAuthService.
  imports: [PrismaModule, QrMesaModule, TenantEstadoModule],
  controllers: [MenuController, MenuAdminController],
  providers: [
    MenuService,
    MenuAdminService,
    StorageService,
    MenuGateway,
    ProcesadorImagenService,
    ImagenesMenuService,
    AuditLogService,
    // BL-515: verificación del token en el canal /menu. Se provee acá y no
    // importando PedidosModule, que ya importa MenuModule (ciclo). Solo
    // depende de TenantEstadoService.
    WsAuthService,
  ],
  exports: [MenuService, MenuAdminService, StorageService, MenuGateway],
})
export class MenuModule {}
