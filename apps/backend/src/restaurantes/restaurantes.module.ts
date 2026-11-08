import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RestaurantesController } from './restaurantes.controller';
import { RestaurantesService } from './restaurantes.service';

@Module({
  imports: [PrismaModule],
  controllers: [RestaurantesController],
  providers: [RestaurantesService],
})
export class RestaurantesModule {}
