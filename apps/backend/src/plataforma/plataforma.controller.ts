import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
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
import { FichaEstablecimientoService } from './ficha-establecimiento.service';
import { DatosEstablecimientoService } from './datos-establecimiento.service';
import { EditarEstablecimientoDto } from './dto/editar-establecimiento.dto';
import { SuspenderEstablecimientoDto } from './dto/suspender-establecimiento.dto';
import { SuspensionEstablecimientoService } from './suspension-establecimiento.service';
import { AccesoAdministradorService } from './acceso-administrador.service';
import { CrearAdministradorDto } from './dto/crear-administrador.dto';
import {
  esFiltroEstado,
  EstablecimientosService,
  FILTROS_ESTADO,
  FiltroEstado,
  MAX_LARGO_BUSQUEDA,
} from './establecimientos.service';

/** BL-163: altas por hora y por usuario de plataforma. */
export const LIMITE_ALTAS_POR_HORA = 10;
/** BL-163: consultas del listado por minuto y por usuario de plataforma. */
export const LIMITE_LISTADOS_POR_MINUTO = 60;
/** BL-412: ediciones de datos por hora y por usuario de plataforma. */
export const LIMITE_EDICIONES_POR_HORA = 30;
/** BL-413: suspensiones y reactivaciones por hora y por usuario de plataforma. */
export const LIMITE_CAMBIOS_DE_ESTADO_POR_HORA = 30;
/**
 * BL-414: restablecimientos de contraseña de Administradores por hora y por
 * usuario de plataforma. Las altas de Administradores tienen el mismo límite,
 * por separado (el throttler cuenta por ruta).
 */
export const LIMITE_ACCESOS_ADMIN_POR_HORA = 10;

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
    private readonly ficha: FichaEstablecimientoService,
    private readonly datos: DatosEstablecimientoService,
    private readonly suspension: SuspensionEstablecimientoService,
    private readonly accesoAdmin: AccesoAdministradorService,
  ) {}

  /**
   * Listado paginado, del alta más reciente a la más vieja. Sin contraseñas:
   * solo datos del tenant, su restaurante y quién lo dio de alta.
   *
   * BL-406: `q` opcional, por razón social o RUT. El ValidationPipe global no
   * valida parámetros sueltos de tipo string, así que se controla acá: un
   * solo valor (no `?q=a&q=b`) y como mucho MAX_LARGO_BUSQUEDA caracteres.
   *
   * BL-410: `estado` opcional (ACTIVOS, SUSPENDIDOS o ALTA_INCOMPLETA), con el
   * mismo control: un solo valor y de la lista.
   */
  @Get()
  @Throttle({ default: { limit: LIMITE_LISTADOS_POR_MINUTO, ttl: 60_000 } })
  listar(
    @Query('pagina', new DefaultValuePipe(1), ParseIntPipe) pagina: number,
    @Query('q') q?: unknown,
    @Query('estado') estado?: unknown,
  ) {
    if (pagina < 1) {
      throw new BadRequestException('pagina tiene que ser 1 o más');
    }
    if (q !== undefined && typeof q !== 'string') {
      throw new BadRequestException('q tiene que ser un solo texto');
    }
    const busqueda = typeof q === 'string' ? q.trim() : undefined;
    if (busqueda && busqueda.length > MAX_LARGO_BUSQUEDA) {
      throw new BadRequestException(
        `q admite como mucho ${MAX_LARGO_BUSQUEDA} caracteres`,
      );
    }
    // BL-410: el filtro ya validado, con su tipo (el guard no acota
    // `unknown` después de un throw).
    let filtro: FiltroEstado | undefined;
    if (estado !== undefined) {
      if (!esFiltroEstado(estado)) {
        throw new BadRequestException(
          `estado tiene que ser uno de: ${FILTROS_ESTADO.join(', ')}`,
        );
      }
      filtro = estado;
    }
    return this.establecimientos.listar(pagina, busqueda || undefined, filtro);
  }

  /**
   * BL-411: ficha de un establecimiento. Mismo límite que el listado. 400 si
   * el id no tiene formato de UUID (ParseUUIDPipe, que acepta los ids fijos
   * del seed) y 404 si no existe. Sin contraseñas ni datos de comensales.
   */
  @Get(':tenantId')
  @Throttle({ default: { limit: LIMITE_LISTADOS_POR_MINUTO, ttl: 60_000 } })
  obtener(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.ficha.obtener(tenantId);
  }

  /**
   * BL-412: corregir los datos del establecimiento. Se cambia lo que viene
   * (400 si no viene nada). RUT inválido: 400 (DTO); RUT de otro
   * establecimiento: 409; inexistente: 404. Devuelve la ficha actualizada.
   * Actor: el sub del token, para la auditoría.
   */
  @Patch(':tenantId')
  @Throttle({
    default: { limit: LIMITE_EDICIONES_POR_HORA, ttl: 60 * 60_000 },
  })
  async editar(
    @Req() req: { user: UsuarioPlataforma },
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: EditarEstablecimientoDto,
  ) {
    await this.datos.actualizar(
      tenantId,
      dto,
      { id: req.user.sub },
      'PLATAFORMA',
    );
    return this.ficha.obtener(tenantId);
  }

  /**
   * BL-413: suspender el establecimiento, con un motivo obligatorio. 404 si
   * no existe, 409 si ya estaba suspendido. No borra datos ni cancela
   * pedidos: desde ahí cualquier token del tenant recibe 403 y se cierran sus
   * sesiones en Keycloak. Devuelve la ficha actualizada.
   */
  @Post(':tenantId/suspender')
  @HttpCode(200)
  @Throttle({
    default: { limit: LIMITE_CAMBIOS_DE_ESTADO_POR_HORA, ttl: 60 * 60_000 },
  })
  async suspender(
    @Req() req: { user: UsuarioPlataforma },
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: SuspenderEstablecimientoDto,
  ) {
    await this.suspension.suspender(tenantId, dto.motivo, {
      id: req.user.sub,
    });
    return this.ficha.obtener(tenantId);
  }

  /**
   * BL-413: reactivar un establecimiento suspendido. 404 si no existe, 409
   * si no estaba suspendido. Devuelve la ficha actualizada.
   */
  @Post(':tenantId/reactivar')
  @HttpCode(200)
  @Throttle({
    default: { limit: LIMITE_CAMBIOS_DE_ESTADO_POR_HORA, ttl: 60 * 60_000 },
  })
  async reactivar(
    @Req() req: { user: UsuarioPlataforma },
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    await this.suspension.reactivar(tenantId, { id: req.user.sub });
    return this.ficha.obtener(tenantId);
  }

  /**
   * BL-414: restablecer la contraseña de un Administrador del
   * establecimiento. Temporal (Keycloak pide cambiarla al ingresar), se
   * muestra una sola vez y se cierran sus sesiones. 404 si el establecimiento
   * no existe o el usuario no es un Administrador de ESE establecimiento; 409
   * si está desactivado. Cache-Control: no-store (lleva la contraseña).
   */
  @Post(':tenantId/administradores/:usuarioId/restablecer-contrasena')
  @HttpCode(200)
  @Throttle({
    default: { limit: LIMITE_ACCESOS_ADMIN_POR_HORA, ttl: 60 * 60_000 },
  })
  @Header('Cache-Control', 'no-store')
  restablecerContrasenaAdministrador(
    @Req() req: { user: UsuarioPlataforma },
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('usuarioId', ParseUUIDPipe) usuarioId: string,
  ) {
    return this.accesoAdmin.restablecerContrasena(tenantId, usuarioId, {
      id: req.user.sub,
    });
  }

  /**
   * BL-414: agregar un Administrador nuevo al establecimiento (Keycloak y
   * fila en `usuario`), con nombre, apellido y correo como en el alta. 404 si
   * el establecimiento no existe, 409 si todavía no tiene restaurante o si el
   * usuario o el correo ya existen. La contraseña temporal vuelve una sola
   * vez. Cache-Control: no-store.
   */
  @Post(':tenantId/administradores')
  @Throttle({
    default: { limit: LIMITE_ACCESOS_ADMIN_POR_HORA, ttl: 60 * 60_000 },
  })
  @Header('Cache-Control', 'no-store')
  crearAdministrador(
    @Req() req: { user: UsuarioPlataforma },
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CrearAdministradorDto,
  ) {
    return this.accesoAdmin.crear(tenantId, dto, { id: req.user.sub });
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
