import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';

/**
 * HU-051 (BL-563): tarjetas aceptadas para el sello de pago seguro.
 *
 * La respuesta de Mercado Pago se simula (jest.spyOn de fetch): el test no
 * sale a internet ni depende de la cuenta de sandbox. Lo que se prueba es
 * el endpoint público de punta a punta: ruta sin login, forma de la
 * respuesta, caché del navegador y que no pase nada más que la lista.
 */

const MEDIOS_MP = [
  {
    id: 'visa',
    name: 'Visa',
    payment_type_id: 'credit_card',
    status: 'active',
    secure_thumbnail: 'https://http2.mlstatic.com/visa.gif',
    // Campos que no tienen que llegar al navegador.
    settings: [{ bin: { pattern: '^4' } }],
    financial_institutions: [],
    processing_modes: ['aggregator'],
  },
  {
    id: 'debvisa',
    name: 'Visa Débito',
    payment_type_id: 'debit_card',
    status: 'active',
    secure_thumbnail: 'https://http2.mlstatic.com/debvisa.gif',
  },
  {
    id: 'abitab',
    name: 'Abitab',
    payment_type_id: 'ticket',
    status: 'active',
    secure_thumbnail: 'https://http2.mlstatic.com/abitab.gif',
  },
];

describe('HU-051: tarjetas aceptadas (integración)', () => {
  let app: INestApplication;
  const entorno = process.env;

  beforeAll(async () => {
    process.env = {
      ...entorno,
      MP_ACCESS_TOKEN: entorno.MP_ACCESS_TOKEN ?? 'TEST-integracion',
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  }, 60000);

  afterAll(async () => {
    process.env = entorno;
    jest.restoreAllMocks();
    if (app) await app.close();
  });

  it('[TC-I-233] HU-051: GET /pagos/tarjetas-aceptadas es público, devuelve una tarjeta por marca solo con id, nombre, imagen y tipo, y se guarda en caché', async () => {
    const fetchReal = global.fetch;
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation((url, init) =>
        String(url).endsWith('/v1/payment_methods')
          ? Promise.resolve(
              new Response(JSON.stringify(MEDIOS_MP), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
          : fetchReal(url, init),
      );

    const res = await request(app.getHttpServer())
      .get('/pagos/tarjetas-aceptadas')
      .expect(HttpStatus.OK);

    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.body).toEqual({
      tarjetas: [
        {
          id: 'visa',
          nombre: 'Visa',
          imagen: 'https://http2.mlstatic.com/visa.gif',
          credito: true,
          debito: true,
        },
      ],
    });

    // La segunda vez sale de la caché: no vuelve a Mercado Pago.
    await request(app.getHttpServer())
      .get('/pagos/tarjetas-aceptadas')
      .expect(HttpStatus.OK);
    const aMercadoPago = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/v1/payment_methods'),
    );
    expect(aMercadoPago).toHaveLength(1);
  });
});
