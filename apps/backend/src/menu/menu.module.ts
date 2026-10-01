import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller';
import { MenuService } from './menu.service';
import { StorageService } from './storage.service';
import { MenuGateway } from './menu.gateway'; // <-- NUEVO
import { MenuAdminService } from './menu-admin.service'; // <-- NUEVO
import { MenuAdminController } from './menu-admin.controller'; // <-- NUEVO
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MenuController, MenuAdminController], // <-- AGREGADO
  providers: [MenuService, MenuAdminService, StorageService, MenuGateway], // <-- AGREGADOS
  exports: [MenuService, MenuAdminService, StorageService, MenuGateway], // <-- AGREGADOS
})
export class MenuModule {}
