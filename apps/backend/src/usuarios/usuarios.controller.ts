import {
  Body,
  Controller,
  Delete,
  Get,
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
    return this.usuariosService.crear(req.user.tenantId, dto);
  }

  @Patch(':id')
  actualizarRol(
    @Req() req: { user: AuthenticatedUser },
    @Param('id') id: string,
    @Body() dto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.actualizarRol(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  desactivar(@Req() req: { user: AuthenticatedUser }, @Param('id') id: string) {
    return this.usuariosService.desactivar(req.user.tenantId, id);
  }
}
