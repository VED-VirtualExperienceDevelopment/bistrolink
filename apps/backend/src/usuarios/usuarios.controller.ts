import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
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

  @Patch(':id')
  actualizarRol(
    @Req() req: { user: AuthenticatedUser },
    @Param('id') id: string,
    @Body() dto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.actualizarRol(
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
  reactivar(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) {
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
    @Param('id') id: string,
  ) {
    return this.usuariosService.restablecerContrasena(
      req.user.tenantId,
      req.user.sub,
      id,
    );
  }

  @Delete(':id')
  desactivar(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) {
    return this.usuariosService.desactivar(req.user.tenantId, req.user.sub, id);
  }
}
