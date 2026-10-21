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

@Module({
  imports: [PrismaModule, QrMesaModule],
  controllers: [MenuController, MenuAdminController],
  providers: [
    MenuService,
    MenuAdminService,
    StorageService,
    MenuGateway,
    ProcesadorImagenService,
    ImagenesMenuService,
    AuditLogService,
  ],
  exports: [MenuService, MenuAdminService, StorageService, MenuGateway],
})
export class MenuModule {}
