import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from '../../src/app.controller';
import { AppService } from '../../src/app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('[TC-U-001] devuelve el nombre del servicio y su estado (BL-526)', () => {
      expect(appController.estado()).toEqual({
        servicio: 'bistrolink-api',
        estado: 'ok',
      });
    });
  });
});
