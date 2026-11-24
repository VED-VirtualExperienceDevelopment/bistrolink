import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TarjetasAceptadasService } from './tarjetas-aceptadas.service';
import type { TarjetaAceptada } from './tarjetas-aceptadas';

/**
 * HU-051 (BL-563): tarjetas aceptadas para el sello de pago seguro.
 *
 * Público, como el menú: lo ve el comensal antes de pagar, sin login, por
 * el QR de la mesa, el enlace web o el link de pago. No depende del local
 * (la cuenta de Mercado Pago es la de la plataforma) ni lleva datos de
 * nadie. El servicio la guarda en caché, así que cada pedido no llega a
 * Mercado Pago; el navegador también la puede guardar una hora.
 */
@ApiTags('Pagos')
@Controller('pagos')
export class TarjetasAceptadasController {
  constructor(private readonly tarjetas: TarjetasAceptadasService) {}

  @Get('tarjetas-aceptadas')
  @Header('Cache-Control', 'public, max-age=3600')
  async listar(): Promise<{ tarjetas: TarjetaAceptada[] }> {
    return { tarjetas: await this.tarjetas.obtener() };
  }
}
