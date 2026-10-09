import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import {
  LIMITE_ALTAS_POR_HORA,
  PlataformaController,
} from '../../src/plataforma/plataforma.controller';
import { PlataformaThrottlerGuard } from '../../src/plataforma/plataforma-throttler.guard';
import { AprovisionamientoService } from '../../src/plataforma/aprovisionamiento.service';
import { EstablecimientosService } from '../../src/plataforma/establecimientos.service';

/**
 * BL-163 (HU-027), entrega 2: POST /plataforma/establecimientos.
 *
 * La autenticación real (token PLATAFORMA) se reemplaza por un guard que
 * toma el usuario del header x-test-sub; las reglas de qué token se acepta
 * están en auth-plataforma.spec.ts y en el e2e. Acá se prueba el
 * controller con el rate limit real.
 */

class AuthFalsa implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: req.headers['x-test-sub'], roles: ['PLATAFORMA'] };
    return true;
  }
}

const ALTA = {
  razonSocial: 'Restaurante de Prueba SRL',
  rut: '219999999901',
  restaurante: { nombre: 'Restaurante de Prueba', direccion: 'Calle 123' },
  admin: {
    username: 'prueba-admin',
    email: 'prueba-admin@prueba.bistrolink.local',
    nombre: 'Admin',
    apellido: 'De Prueba',
  },
  cocina: { username: 'prueba-cocina' },
};

describe('PlataformaController (BL-163)', () => {
  let app: INestApplication;
  const aprovisionamiento = { aprovisionar: jest.fn() };
  const establecimientos = { listar: jest.fn() };

  beforeEach(async () => {
    establecimientos.listar.mockReset().mockResolvedValue({
      pagina: 1,
      tamanoPagina: 20,
      total: 0,
      items: [],
    });
    aprovisionamiento.aprovisionar.mockReset().mockResolvedValue({
      tenantId: 'tenant-nuevo',
      usuarios: [],
    });

    const moduleRef = await Test.createTestingModule({
      // Como en la aplicación: ThrottlerModule global (lo registra
      // MesasModule) con un límite por defecto que la ruta pisa.
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1 }])],
      controllers: [PlataformaController],
      providers: [
        PlataformaThrottlerGuard,
        { provide: AprovisionamientoService, useValue: aprovisionamiento },
        { provide: EstablecimientosService, useValue: establecimientos },
      ],
    })
      .overrideGuard(AuthGuard('jwt-plataforma'))
      .useClass(AuthFalsa)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const alta = (sub: string, body: object = ALTA) =>
    request(app.getHttpServer())
      .post('/plataforma/establecimientos')
      .set('x-test-sub', sub)
      .send(body);

  it('da de alta con el sub del token como actor y contraseñas generadas por el servicio', async () => {
    const res = await alta('kc-plataforma-1').expect(201);

    expect(res.body).toEqual({ tenantId: 'tenant-nuevo', usuarios: [] });
    expect(aprovisionamiento.aprovisionar).toHaveBeenCalledWith(
      expect.objectContaining({ rut: '219999999901' }),
      {},
      { id: 'kc-plataforma-1' },
    );
  });

  it('responde con Cache-Control: no-store (la respuesta lleva contraseñas temporales)', async () => {
    const res = await alta('kc-plataforma-1').expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rechaza con 400 datos inválidos sin llamar al servicio', async () => {
    await alta('kc-plataforma-1', { ...ALTA, rut: '123' }).expect(400);
    expect(aprovisionamiento.aprovisionar).not.toHaveBeenCalled();
  });

  it(`limita a ${LIMITE_ALTAS_POR_HORA} altas por hora por usuario (429 después)`, async () => {
    for (let i = 0; i < LIMITE_ALTAS_POR_HORA; i++) {
      await alta('kc-plataforma-1').expect(201);
    }
    await alta('kc-plataforma-1').expect(429);
    expect(aprovisionamiento.aprovisionar).toHaveBeenCalledTimes(
      LIMITE_ALTAS_POR_HORA,
    );
  });

  it('el límite es por usuario, no global', async () => {
    for (let i = 0; i < LIMITE_ALTAS_POR_HORA; i++) {
      await alta('kc-plataforma-1').expect(201);
    }
    await alta('kc-plataforma-1').expect(429);
    await alta('kc-plataforma-2').expect(201);
  });

  const listado = (query = '') =>
    request(app.getHttpServer())
      .get(`/plataforma/establecimientos${query}`)
      .set('x-test-sub', 'kc-plataforma-1');

  it('lista la primera página si no se indica', async () => {
    const res = await listado().expect(200);

    expect(res.body).toEqual({
      pagina: 1,
      tamanoPagina: 20,
      total: 0,
      items: [],
    });
    expect(establecimientos.listar).toHaveBeenCalledWith(1);
  });

  it('pasa la página pedida', async () => {
    await listado('?pagina=3').expect(200);
    expect(establecimientos.listar).toHaveBeenCalledWith(3);
  });

  it.each(['0', '-1', 'abc'])(
    'rechaza con 400 la página %p sin consultar',
    async (pagina) => {
      await listado(`?pagina=${pagina}`).expect(400);
      expect(establecimientos.listar).not.toHaveBeenCalled();
    },
  );

  it('el listado no consume el límite de altas', async () => {
    for (let i = 0; i < LIMITE_ALTAS_POR_HORA; i++) {
      await listado().expect(200);
    }
    await alta('kc-plataforma-1').expect(201);
  });
});

describe('PlataformaThrottlerGuard.getTracker (BL-163)', () => {
  const guard = Object.create(
    PlataformaThrottlerGuard.prototype,
  ) as PlataformaThrottlerGuard;

  it('cuenta por el sub del usuario de plataforma, no por IP', async () => {
    const tracker = await (guard as any).getTracker({
      user: { sub: 'kc-plataforma-1' },
      ip: '10.0.0.1',
    });
    expect(tracker).toBe('kc-plataforma-1');
  });

  it('usa la IP solo si no hay usuario', async () => {
    const tracker = await (guard as any).getTracker({ ip: '10.0.0.1' });
    expect(tracker).toBe('10.0.0.1');
  });
});
