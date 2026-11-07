import { Module, type Type } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PedidosModule } from '../pedidos/pedidos.module';
import { MenuModule } from '../menu/menu.module';
import { PlataformaModule } from '../plataforma/plataforma.module';
import { AuditLogService } from '../audit-log/audit-log.service';
import { LimpiezaPruebasController } from './limpieza-pruebas.controller';
import { LimpiezaPruebasService } from './limpieza-pruebas.service';
import { LimpiezaMesasService } from './limpieza-mesas.service';
import { LimpiezaCartaService } from './limpieza-carta.service';
import { LimpiezaConfiguracionService } from './limpieza-configuracion.service';
import { LimpiezaUsuariosService } from './limpieza-usuarios.service';
import { LimpiezaEstablecimientosService } from './limpieza-establecimientos.service';
import { LimpiezaEstablecimientosController } from './limpieza-establecimientos.controller';
import { ConfiguracionEstablecimientoService } from '../configuracion/configuracion-establecimiento.service';
import { UsuariosService } from '../usuarios/usuarios.service';
import { KeycloakAdminService } from '../keycloak-admin/keycloak-admin.service';

/**
 * BL-475 (BL-285, ADR 0011): herramientas para los datos de prueba
 * (limpieza de local y staging). Solo se registra con
 * E2E_CLEANUP_ENABLED=true: en staging y en local sí, en producción nunca
 * (checklist de BL-232). Sin la variable, las rutas no existen (404).
 *
 * - POST /testing/limpieza (ADMIN): pedidos, mesas, carta, configuración y
 *   usuarios del tenant del token.
 * - POST /testing/limpieza/establecimientos (PLATAFORMA, BL-482): los
 *   establecimientos «E2E Plataforma …». Usa PlataformaModule.
 */
@Module({
  imports: [PrismaModule, PedidosModule, MenuModule, PlataformaModule],
  controllers: [LimpiezaPruebasController, LimpiezaEstablecimientosController],
  providers: [
    LimpiezaPruebasService,
    LimpiezaMesasService,
    LimpiezaCartaService,
    LimpiezaConfiguracionService,
    LimpiezaUsuariosService,
    LimpiezaEstablecimientosService,
    // BL-481: los mismos servicios que usan Configuración y Usuarios, para
    // que la limpieza siga sus reglas y su auditoría.
    ConfiguracionEstablecimientoService,
    UsuariosService,
    KeycloakAdminService,
    AuditLogService,
  ],
})
export class TestingModule {}

/** Los módulos de testing que corresponden a este entorno (vacío si no). */
export function modulosDeTesting(env: NodeJS.ProcessEnv = process.env): Type[] {
  return env.E2E_CLEANUP_ENABLED === 'true' ? [TestingModule] : [];
}
