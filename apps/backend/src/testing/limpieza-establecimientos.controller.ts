import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { UsuarioPlataforma } from '../auth/plataforma-jwt.strategy';
import {
  LimpiezaEstablecimientosService,
  type ResumenEstablecimientos,
} from './limpieza-establecimientos.service';

/** BL-482: solo `dryRun`; los establecimientos se buscan por la marca E2E. */
export class LimpiarEstablecimientosDto {
  @IsOptional()
  @IsBoolean({ message: 'dryRun debe ser verdadero o falso' })
  dryRun?: boolean;
}

/**
 * BL-482 (BL-285, ADR 0011): `POST /testing/limpieza/establecimientos`.
 * Solo rol PLATAFORMA (mismo guard que la pantalla de plataforma, con su
 * OTP), porque toca establecimientos que no son del token. Fuera del
 * contrato OpenAPI. Solo existe con E2E_CLEANUP_ENABLED=true.
 */
@ApiExcludeController()
@Controller('testing/limpieza')
@UseGuards(AuthGuard('jwt-plataforma'))
export class LimpiezaEstablecimientosController {
  constructor(private readonly limpieza: LimpiezaEstablecimientosService) {}

  @Post('establecimientos')
  @HttpCode(HttpStatus.OK)
  limpiar(
    @Req() req: { user: UsuarioPlataforma },
    @Body() dto: LimpiarEstablecimientosDto,
  ): Promise<ResumenEstablecimientos> {
    return this.limpieza.limpiar(req.user.sub, dto.dryRun === true);
  }
}
