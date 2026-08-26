import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthComensalService } from './auth-comensal.service';
import { EmitirTokenComensalDto } from './dto/emitir-token-comensal.dto';

@Controller('auth/comensal')
export class AuthComensalController {
  constructor(private readonly authComensalService: AuthComensalService) {}

  @Post()
  @HttpCode(200)
  emitirToken(@Body() dto: EmitirTokenComensalDto) {
    return this.authComensalService.emitirToken(dto.tenantId, dto.mesaId);
  }
}
