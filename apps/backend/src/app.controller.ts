import { Controller, Get } from '@nestjs/common';
import { AppService, type EstadoServicio } from './app.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Sistema')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** BL-526: nombre del servicio y estado, en JSON. */
  @Get()
  estado(): EstadoServicio {
    return this.appService.estado();
  }
}
