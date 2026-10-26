import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/keycloak-jwt.strategy';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SEGURIDAD_KEYCLOAK } from '../openapi';

@ApiTags('Usuarios')
@ApiBearerAuth(SEGURIDAD_KEYCLOAK)
@Controller('usuarios')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  listar(@Req() req: { user: AuthenticatedUser }) {
    return this.usuariosService.listar(req.user.tenantId);
  }

  @Post()
  crear(
    @Req() req: { user: AuthenticatedUser },
    @Body() dto: CreateUsuarioDto,
  ) {
    // req.user.sub: ID de Keycloak del Administrador que ejecuta la acción
    // (nunca del body) — es lo que AuditLogService registra como actor.
    return this.usuariosService.crear(req.user.tenantId, req.user.sub, dto);
  }

  // ── BL-362: cuenta de cocina (vive solo en Keycloak, sin fila en `usuario`).
  // Se identifica por su id de Keycloak. El servicio verifica que sea del
  // tenant del token y que tenga el rol COCINA; si no, 404. No hay alta ni
  // cambio de rol: la crea el alta de establecimiento (HU-027).
  @Post('cocina/:keycloakId/restablecer-contrasena')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  restablecerContrasenaCocina(
    @Req() req: { user: AuthenticatedUser },
    @Param('keycloakId', new ParseUUIDPipe()) keycloakId: string,
  ) {
    return this.usuariosService.restablecerContrasenaCocina(
      req.user.tenantId,
      req.user.sub,
      keycloakId,
    );
  }

  @Patch('cocina/:keycloakId/activar')
  reactivarCocina(
    @Req() req: { user: AuthenticatedUser },
    @Param('keycloakId', new ParseUUIDPipe()) keycloakId: string,
  ) {
    return this.usuariosService.reactivarCocina(
      req.user.tenantId,
      req.user.sub,
      keycloakId,
    );
  }

  // BL-367: cerrar las sesiones de la cuenta de cocina (sigue activa).
  @Post('cocina/:keycloakId/cerrar-sesiones')
  @HttpCode(HttpStatus.OK)
  cerrarSesionesCocina(
    @Req() req: { user: AuthenticatedUser },
    @Param('keycloakId', new ParseUUIDPipe()) keycloakId: string,
  ) {
    return this.usuariosService.cerrarSesionesCocina(
      req.user.tenantId,
      req.user.sub,
      keycloakId,
    );
  }

  @Delete('cocina/:keycloakId')
  desactivarCocina(
    @Req() req: { user: AuthenticatedUser },
    @Param('keycloakId', new ParseUUIDPipe()) keycloakId: string,
  ) {
    return this.usuariosService.desactivarCocina(
      req.user.tenantId,
      req.user.sub,
      keycloakId,
    );
  }

  // BL-356: todas las rutas /usuarios/:id validan el formato del id con
  // ParseUUIDPipe (acepta cualquier UUID, incluidos los ids fijos del seed),
  // igual que las de keycloakId: un id inválido es un 400 y no un 500.

  // Rol y, desde BL-366, nombre, apellido y correo (lo que venga en el body).
  @Patch(':id')
  actualizar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.actualizar(
      req.user.tenantId,
      req.user.sub,
      id,
      dto,
    );
  }

  // BL-358: vuelve a habilitar un usuario desactivado. Ruta propia (y no
  // un campo `activo` en PATCH /usuarios/:id) para que reactivar sea una
  // acción explícita, con su propio registro en la auditoría.
  @Patch(':id/activar')
  reactivar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.usuariosService.reactivar(req.user.tenantId, req.user.sub, id);
  }

  // BL-359: genera una contraseña temporal nueva y cierra las sesiones del
  // usuario. Responde 200 (no 201: no se crea ningún recurso) y con
  // Cache-Control: no-store, porque la respuesta trae la contraseña.
  @Post(':id/restablecer-contrasena')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  restablecerContrasena(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.usuariosService.restablecerContrasena(
      req.user.tenantId,
      req.user.sub,
      id,
    );
  }

  // BL-367: cierra las sesiones abiertas sin desactivar al usuario. 200 y no
  // 201: no se crea ningún recurso.
  @Post(':id/cerrar-sesiones')
  @HttpCode(HttpStatus.OK)
  cerrarSesiones(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.usuariosService.cerrarSesiones(
      req.user.tenantId,
      req.user.sub,
      id,
    );
  }

  // BL-382: eliminar definitivamente (solo usuarios sin historial). Ruta
  // propia: DELETE /usuarios/:id sigue siendo desactivar.
  @Delete(':id/permanente')
  eliminar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.usuariosService.eliminar(req.user.tenantId, req.user.sub, id);
  }

  @Delete(':id')
  desactivar(
    @Req() req: { user: AuthenticatedUser },
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.usuariosService.desactivar(req.user.tenantId, req.user.sub, id);
  }
}
