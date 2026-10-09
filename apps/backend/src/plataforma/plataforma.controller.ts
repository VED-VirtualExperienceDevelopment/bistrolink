import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { UsuarioPlataforma } from '../auth/plataforma-jwt.strategy';
import { AprovisionamientoService } from './aprovisionamiento.service';
import { AprovisionarEstablecimientoDto } from './dto/aprovisionar-establecimiento.dto';
import { PlataformaThrottlerGuard } from './plataforma-throttler.guard';
import { EstablecimientosService } from './establecimientos.service';

/** BL-163: altas por hora y por usuario de plataforma. */
export const LIMITE_ALTAS_POR_HORA = 10;
/** BL-163: consultas del listado por minuto y por usuario de plataforma. */
export const LIMITE_LISTADOS_POR_MINUTO = 60;

/**
 * BL-163 (HU-027), entrega 2: alta de establecimientos para el rol
 * PLATAFORMA. Mismo servicio que el script.
 *
 * - AuthGuard('jwt-plataforma'): solo tokens con rol PLATAFORMA y sin
 *   tenant_id (ver PlataformaJwtStrategy). No usa RolesGuard ni pasa por
 *   el contexto de un tenant del token: el tenant es el que se crea.
 * - PlataformaThrottlerGuard + @Throttle: [S] rate limiting por usuario.
 *
 * Las contraseñas del Admin y de Cocina las genera el servicio (temporales:
 * Keycloak pide cambiarlas en el primer login) y vuelven una sola vez en la
 * respuesta, como en POST /usuarios. Cache-Control: no-store para que
 * ningún proxy ni el navegador guarde esa respuesta.
 */
@Controller('plataforma/establecimientos')
@UseGuards(AuthGuard('jwt-plataforma'), PlataformaThrottlerGuard)
export class PlataformaController {
  constructor(
    private readonly aprovisionamiento: AprovisionamientoService,
    private readonly establecimientos: EstablecimientosService,
  ) {}

  /**
   * Listado paginado, del alta más reciente a la más vieja. Sin contraseñas:
   * solo datos del tenant, su restaurante y quién lo dio de alta.
   */
  @Get()
  @Throttle({ default: { limit: LIMITE_LISTADOS_POR_MINUTO, ttl: 60_000 } })
  listar(
    @Query('pagina', new DefaultValuePipe(1), ParseIntPipe) pagina: number,
  ) {
    if (pagina < 1) {
      throw new BadRequestException('pagina tiene que ser 1 o más');
    }
    return this.establecimientos.listar(pagina);
  }

  @Post()
  @Throttle({ default: { limit: LIMITE_ALTAS_POR_HORA, ttl: 60 * 60_000 } })
  @Header('Cache-Control', 'no-store')
  aprovisionar(
    @Req() req: { user: UsuarioPlataforma },
    @Body() dto: AprovisionarEstablecimientoDto,
  ) {
    // Actor: el sub del token, nunca un dato del body. El username para
    // "creado por" lo busca el servicio en Keycloak.
    return this.aprovisionamiento.aprovisionar(dto, {}, { id: req.user.sub });
  }
}
