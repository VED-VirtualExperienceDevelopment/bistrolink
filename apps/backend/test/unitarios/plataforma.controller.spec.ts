import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
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
import { FichaEstablecimientoService } from '../../src/plataforma/ficha-establecimiento.service';
import { DatosEstablecimientoService } from '../../src/plataforma/datos-establecimiento.service';
import { SuspensionEstablecimientoService } from '../../src/plataforma/suspension-establecimiento.service';

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

// BL-411: id fijo con formato del seed (no es un UUID v4).
const TENANT_ID = '11111111-1111-1111-1111-111111111111';

const ALTA = {
  razonSocial: 'Restaurante de Prueba SRL',
  rut: '219999990016',
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
  const ficha = { obtener: jest.fn() };
  const datos = { actualizar: jest.fn() };
  const suspension = { suspender: jest.fn(), reactivar: jest.fn() };

  beforeEach(async () => {
    establecimientos.listar.mockReset().mockResolvedValue({
      pagina: 1,
      tamanoPagina: 20,
      total: 0,
      items: [],
    });
    datos.actualizar.mockReset().mockResolvedValue(['razonSocial']);
    suspension.suspender.mockReset().mockResolvedValue(undefined);
    suspension.reactivar.mockReset().mockResolvedValue(undefined);
    ficha.obtener
      .mockReset()
      .mockResolvedValue({ tenantId: TENANT_ID, razonSocial: 'Uno SRL' });
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
        { provide: FichaEstablecimientoService, useValue: ficha },
        { provide: DatosEstablecimientoService, useValue: datos },
        { provide: SuspensionEstablecimientoService, useValue: suspension },
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
      expect.objectContaining({ rut: '219999990016' }),
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
    expect(establecimientos.listar).toHaveBeenCalledWith(
      1,
      undefined,
      undefined,
    );
  });

  it('pasa la página pedida', async () => {
    await listado('?pagina=3').expect(200);
    expect(establecimientos.listar).toHaveBeenCalledWith(
      3,
      undefined,
      undefined,
    );
  });

  it('BL-406: pasa la búsqueda sin espacios de más', async () => {
    await listado('?pagina=2&q=%20Uno%20SRL%20').expect(200);
    expect(establecimientos.listar).toHaveBeenCalledWith(
      2,
      'Uno SRL',
      undefined,
    );
  });

  it('BL-406: una búsqueda vacía o solo con espacios no filtra', async () => {
    await listado('?q=%20%20').expect(200);
    expect(establecimientos.listar).toHaveBeenCalledWith(
      1,
      undefined,
      undefined,
    );
  });

  it('BL-406: rechaza con 400 una búsqueda de más de 100 caracteres', async () => {
    await listado(`?q=${'a'.repeat(101)}`).expect(400);
    expect(establecimientos.listar).not.toHaveBeenCalled();
  });

  it('BL-406: rechaza con 400 la búsqueda repetida (q=a&q=b)', async () => {
    await listado('?q=a&q=b').expect(400);
    expect(establecimientos.listar).not.toHaveBeenCalled();
  });

  it.each(['ACTIVOS', 'SUSPENDIDOS', 'ALTA_INCOMPLETA'])(
    'BL-410: pasa el filtro por estado %p',
    async (estado) => {
      await listado(`?estado=${estado}`).expect(200);
      expect(establecimientos.listar).toHaveBeenCalledWith(
        1,
        undefined,
        estado,
      );
    },
  );

  it('BL-410: combina el filtro por estado con la búsqueda', async () => {
    await listado('?pagina=2&q=uno&estado=SUSPENDIDOS').expect(200);
    expect(establecimientos.listar).toHaveBeenCalledWith(
      2,
      'uno',
      'SUSPENDIDOS',
    );
  });

  it.each(['activos', 'TODOS', '', 'SUSPENDIDO'])(
    'BL-410: rechaza con 400 el estado %p sin consultar',
    async (estado) => {
      await listado(`?estado=${estado}`).expect(400);
      expect(establecimientos.listar).not.toHaveBeenCalled();
    },
  );

  it('BL-410: rechaza con 400 el estado repetido', async () => {
    await listado('?estado=ACTIVOS&estado=SUSPENDIDOS').expect(400);
    expect(establecimientos.listar).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'abc'])(
    'rechaza con 400 la página %p sin consultar',
    async (pagina) => {
      await listado(`?pagina=${pagina}`).expect(400);
      expect(establecimientos.listar).not.toHaveBeenCalled();
    },
  );

  it('BL-411: devuelve la ficha del establecimiento', async () => {
    const res = await listado(`/${TENANT_ID}`).expect(200);

    expect(res.body).toEqual({ tenantId: TENANT_ID, razonSocial: 'Uno SRL' });
    expect(ficha.obtener).toHaveBeenCalledWith(TENANT_ID);
  });

  it('BL-411: rechaza con 400 un id que no es UUID, sin consultar', async () => {
    await listado('/no-es-un-uuid').expect(400);
    expect(ficha.obtener).not.toHaveBeenCalled();
  });

  it('BL-411: un establecimiento inexistente da 404', async () => {
    ficha.obtener.mockRejectedValue(
      new NotFoundException('No existe un establecimiento con ese id'),
    );
    await listado(`/${TENANT_ID}`).expect(404);
  });

  const editar = (body: object, id = TENANT_ID) =>
    request(app.getHttpServer())
      .patch(`/plataforma/establecimientos/${id}`)
      .set('x-test-sub', 'kc-plataforma-1')
      .send(body);

  it('BL-412: edita con el sub del token como actor y devuelve la ficha actualizada', async () => {
    const res = await editar({ razonSocial: 'Uno y Cía SRL' }).expect(200);

    expect(datos.actualizar).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ razonSocial: 'Uno y Cía SRL' }),
      { id: 'kc-plataforma-1' },
      'PLATAFORMA',
    );
    expect(ficha.obtener).toHaveBeenCalledWith(TENANT_ID);
    expect(res.body).toEqual({ tenantId: TENANT_ID, razonSocial: 'Uno SRL' });
  });

  it('BL-412: RUT inválido da 400 sin llamar al servicio', async () => {
    await editar({ rut: '219999990017' }).expect(400);
    expect(datos.actualizar).not.toHaveBeenCalled();
  });

  it('BL-412: rechaza con 400 campos que no se pueden editar', async () => {
    await editar({ estado: 'SUSPENDIDO' }).expect(400);
    await editar({ creadoPor: 'otro' }).expect(400);
    expect(datos.actualizar).not.toHaveBeenCalled();
  });

  it('BL-412: RUT de otro establecimiento da 409', async () => {
    datos.actualizar.mockRejectedValue(
      new ConflictException('El RUT ya pertenece a otro establecimiento'),
    );
    await editar({ rut: '219999990016' }).expect(409);
    expect(ficha.obtener).not.toHaveBeenCalled();
  });

  it('BL-412: rechaza con 400 un id que no es UUID', async () => {
    await editar({ razonSocial: 'Uno' }, 'no-es-un-uuid').expect(400);
    expect(datos.actualizar).not.toHaveBeenCalled();
  });

  const suspender = (body: object, id = TENANT_ID) =>
    request(app.getHttpServer())
      .post(`/plataforma/establecimientos/${id}/suspender`)
      .set('x-test-sub', 'kc-plataforma-1')
      .send(body);

  const reactivar = (id = TENANT_ID) =>
    request(app.getHttpServer())
      .post(`/plataforma/establecimientos/${id}/reactivar`)
      .set('x-test-sub', 'kc-plataforma-1');

  it('[TC-U-125] BL-413: suspende con el motivo sin espacios de más y el sub del token, y devuelve la ficha (200)', async () => {
    const res = await suspender({ motivo: '  Falta   de pago  ' }).expect(200);

    expect(suspension.suspender).toHaveBeenCalledWith(
      TENANT_ID,
      'Falta de pago',
      { id: 'kc-plataforma-1' },
    );
    expect(ficha.obtener).toHaveBeenCalledWith(TENANT_ID);
    expect(res.body).toEqual({ tenantId: TENANT_ID, razonSocial: 'Uno SRL' });
  });

  it.each([
    ['sin motivo', {}],
    ['motivo vacío', { motivo: '   ' }],
    ['motivo de 2 caracteres', { motivo: 'ab' }],
    ['motivo de 201 caracteres', { motivo: 'a'.repeat(201) }],
    ['motivo que no es texto', { motivo: 123 }],
    ['campos de más', { motivo: 'Falta de pago', estado: 'ACTIVO' }],
  ])(
    '[TC-U-126] BL-413: rechaza con 400 (%s) sin suspender',
    async (_caso, body) => {
      await suspender(body).expect(400);
      expect(suspension.suspender).not.toHaveBeenCalled();
    },
  );

  it('BL-413: acepta un motivo de 200 caracteres', async () => {
    await suspender({ motivo: 'a'.repeat(200) }).expect(200);
  });

  it('BL-413: suspender un establecimiento ya suspendido da 409', async () => {
    suspension.suspender.mockRejectedValue(
      new ConflictException('El establecimiento ya está suspendido'),
    );
    await suspender({ motivo: 'Falta de pago' }).expect(409);
    expect(ficha.obtener).not.toHaveBeenCalled();
  });

  it('[TC-U-127] BL-413: reactiva con el sub del token y devuelve la ficha (200)', async () => {
    const res = await reactivar().expect(200);

    expect(suspension.reactivar).toHaveBeenCalledWith(TENANT_ID, {
      id: 'kc-plataforma-1',
    });
    expect(res.body).toEqual({ tenantId: TENANT_ID, razonSocial: 'Uno SRL' });
  });

  it('BL-413: reactivar uno que no está suspendido da 409 y uno inexistente 404', async () => {
    suspension.reactivar.mockRejectedValueOnce(
      new ConflictException('El establecimiento no está suspendido'),
    );
    await reactivar().expect(409);

    suspension.reactivar.mockRejectedValueOnce(
      new NotFoundException('No existe un establecimiento con ese id'),
    );
    await reactivar().expect(404);
  });

  it('BL-413: rechaza con 400 un id que no es UUID al suspender y al reactivar', async () => {
    await suspender({ motivo: 'Falta de pago' }, 'no-es-un-uuid').expect(400);
    await reactivar('no-es-un-uuid').expect(400);
    expect(suspension.suspender).not.toHaveBeenCalled();
    expect(suspension.reactivar).not.toHaveBeenCalled();
  });

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
