// BL-216 — Contrato con Surtec (facturación electrónica, CFE).
//
// Fija solo lo que SurtecClient envía y lee hoy:
//   - POST {SURTEC_AUTH_URL}/token: entrar con usuario y contraseña y renovar
//     con el refresh token. Leemos access_token y refresh_token.
//   - POST {SURTEC_API_URL}/comprobantes/crear: emitir un e-Ticket (tipo 101)
//     y, desde HU-009 (BL-453), una e-Factura (tipo 111) con el objeto
//     `cliente`. Leemos id, serie, numero, hash, cae_numero, cae_vencimiento
//     y url.
//
//   - GET {SURTEC_API_URL}/consulta/comprobantes/emitidos: estado ante la DGI
//     de los CFE emitidos en un rango de fechas (HU-009, BL-455). Leemos id,
//     serie, numero y estado_dgi (código y motivo).
//
// Qué NO cubre todavía (cada contrato se suma con la historia que lo usa):
//   - Nota de crédito: HU-024. La API no tiene descarga de PDF ni XML
//     (BL-454).
//   - Integración con el POS: BL-100.
//
// Las dos URLs apuntan al mismo mock: los paths no se pisan. Cada test lleva
// su [TC-C-NNN]: es el título del caso en el Test Plan «Contract-PactJS» de
// Kiwi TCMS (ver test/contract/README.md).
import { resolve } from 'node:path';
import {
  MatchersV3,
  PactV4,
  SpecificationVersion,
} from '@pact-foundation/pact';
import {
  SolicitudEmision,
  SurtecClient,
  SurtecError,
} from '../../src/cfe/surtec.client';

const { like, regex, eachLike } = MatchersV3;

// Datos de ejemplo: ni credenciales ni RUT reales (el repositorio es público).
const USUARIO = 'usuario-contrato';
const CLAVE = 'clave-contrato';
const RUT_EMISOR = '219999990019';
const TOKEN_1 = 'token-acceso-contrato-1';
const REFRESH_1 = 'token-refresco-contrato-1';
const TOKEN_2 = 'token-acceso-contrato-2';
const REFRESH_2 = 'token-refresco-contrato-2';

const RUT = '^\\d{12}$';
const FECHA_HORA = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}';

// El tipo del builder no se exporta desde la raíz del paquete.
type V4UnconfiguredInteraction = ReturnType<PactV4['addInteraction']>;

const pact = new PactV4({
  consumer: 'bistrolink-backend',
  provider: 'surtec-cfe-api',
  dir: resolve(__dirname, '../../pacts'),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V4,
  logLevel: 'warn',
});

const SOLICITUD: SolicitudEmision = {
  rutEmisor: RUT_EMISOR,
  idExterno: 'bl-pago-contrato-1',
  items: [{ concepto: 'Milanesa', cantidad: 1, precio: 590 }],
  adenda: 'Pedido 1',
};

// Cuerpo de la emisión tal como lo arma SurtecClient.emitirETicket(). Valores
// exactos donde el código fija el dato (tipo, forma de pago, moneda, IVA).
function cuerpoETicket(sucursal = 1) {
  return {
    sucursal: like(sucursal),
    tipo_comprobante: 101,
    forma_pago: 1,
    moneda: 'UYU',
    cod_montos_brutos: 1,
    id_externo: like('bl-pago-contrato-1'),
    items: eachLike({
      cantidad: like(1),
      concepto: like('Milanesa'),
      precio: like(590),
      indicador_facturacion: 3,
      unidad: 'Un',
    }),
    adenda: { texto: like('Pedido 1') },
  };
}

// HU-009 (BL-453): receptor de ejemplo, con dígito verificador válido.
const RECEPTOR = { rut: '219999830019', razonSocial: 'Comensal Ejemplo SAS' };

// Cuerpo de la e-Factura: el del e-Ticket con tipo 111 y el cliente. El
// campo es `denominacion` (tabla de la guía de Surtec; el ejemplo JSON de la
// guía dice `nombre`, a confirmar en el sandbox).
function cuerpoEFactura() {
  return {
    ...cuerpoETicket(),
    tipo_comprobante: 111,
    cliente: {
      tipo_doc: 2,
      cod_pais_doc: 'UY',
      nro_doc: regex(RUT, RECEPTOR.rut),
      denominacion: like(RECEPTOR.razonSocial),
    },
  };
}

const RESPUESTA_ETICKET = {
  id: like(541759),
  serie: regex('^[A-Z]{1,2}$', 'A'),
  numero: like(49),
  hash: like('YuFjLi8FhjlpqbniSfBS0OfmpPFErwiODpihtMqCyYs='),
  cae_numero: like(90191275538),
  cae_vencimiento: regex(FECHA_HORA, '2030-12-31T00:00:00'),
  url: regex('^https://', 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x'),
};

// Interacciones que se repiten entre tests. Pact las guarda una sola vez en
// el contrato porque son idénticas (misma descripción, estado y cuerpo).
function loginConUsuario(
  i: V4UnconfiguredInteraction,
  token = TOKEN_1,
  refresh = REFRESH_1,
) {
  return i
    .given('el usuario de la API de Surtec está habilitado')
    .uponReceiving('un login con usuario y contraseña')
    .withRequest('POST', '/token', (b) => {
      b.headers({ 'Content-Type': 'application/json' }).jsonBody({
        grant_type: 'password',
        username: like(USUARIO),
        password: like(CLAVE),
      });
    })
    .willRespondWith(200, (b) => {
      b.jsonBody({ access_token: like(token), refresh_token: like(refresh) });
    });
}

function renovacionConRefresh(i: V4UnconfiguredInteraction) {
  return i
    .given('el refresh token emitido por Surtec sigue vigente')
    .uponReceiving('una renovación del token con el refresh token')
    .withRequest('POST', '/token', (b) => {
      b.headers({ 'Content-Type': 'application/json' }).jsonBody({
        grant_type: 'refresh_token',
        refresh_token: like(REFRESH_1),
      });
    })
    .willRespondWith(200, (b) => {
      b.jsonBody({
        access_token: like(TOKEN_2),
        refresh_token: like(REFRESH_2),
      });
    });
}

function emisionAceptada(i: V4UnconfiguredInteraction) {
  return i
    .given('el emisor está habilitado en Surtec para emitir e-Tickets')
    .uponReceiving('una emisión de e-Ticket que Surtec acepta')
    .withRequest('POST', '/comprobantes/crear', (b) => {
      b.headers({
        Authorization: regex('^Bearer \\S+$', `Bearer ${TOKEN_1}`),
        'X-Emisor': regex(RUT, RUT_EMISOR),
        'Content-Type': 'application/json',
      }).jsonBody(cuerpoETicket());
    })
    .willRespondWith(200, (b) => {
      b.jsonBody(RESPUESTA_ETICKET);
    });
}

describe('Contrato Surtec — facturación electrónica (BL-216)', () => {
  const envOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...envOriginal };
  });

  function clienteContra(mockUrl: string): SurtecClient {
    process.env.SURTEC_AUTH_URL = mockUrl;
    process.env.SURTEC_API_URL = mockUrl;
    process.env.SURTEC_USER = USUARIO;
    process.env.SURTEC_PASSWORD = CLAVE;
    delete process.env.SURTEC_SUCURSAL;
    return new SurtecClient();
  }

  describe('POST /token — autenticación', () => {
    it('[TC-C-010] Surtec Auth: POST /token con usuario y contraseña responde 200 con access_token y refresh_token', async () => {
      loginConUsuario(pact.addInteraction());
      await emisionAceptada(pact.addInteraction()).executeTest(async (mock) => {
        const cfe = await clienteContra(mock.url).emitirETicket(SOLICITUD);

        // Si el login no hubiera dado un token, la emisión no se habría hecho.
        expect(cfe.serie).toBe('A');
      });
    });

    it('[TC-C-011] Surtec Auth: POST /token con el refresh token vigente responde 200 con un token nuevo', async () => {
      loginConUsuario(pact.addInteraction());
      renovacionConRefresh(pact.addInteraction());
      await emisionAceptada(pact.addInteraction()).executeTest(async (mock) => {
        const client = clienteContra(mock.url);
        await client.emitirETicket(SOLICITUD);
        // Simula el paso de las 11 horas de vida del token.
        (client as unknown as { venceEn: number }).venceEn = 0;

        const cfe = await client.emitirETicket(SOLICITUD);

        expect(cfe.numero).toBe(49);
      });
    });
  });

  describe('POST /comprobantes/crear — emitir el e-Ticket', () => {
    it('[TC-C-012] Surtec CFE: POST /comprobantes/crear de un e-Ticket responde 200 con serie, número, hash, CAE y URL de DGI', async () => {
      loginConUsuario(pact.addInteraction());
      await emisionAceptada(pact.addInteraction()).executeTest(async (mock) => {
        const cfe = await clienteContra(mock.url).emitirETicket(SOLICITUD);

        expect(cfe).toEqual({
          id: '541759',
          serie: 'A',
          numero: 49,
          hash: 'YuFjLi8FhjlpqbniSfBS0OfmpPFErwiODpihtMqCyYs=',
          caeNumero: '90191275538',
          caeVencimiento: new Date('2030-12-31T00:00:00'),
          url: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
        });
      });
    });

    it('[TC-C-013] Surtec CFE: POST /comprobantes/crear con el token vencido responde 401 y BistroLink renueva el token y reintenta una vez', async () => {
      loginConUsuario(pact.addInteraction());
      pact
        .addInteraction()
        .given('el token de acceso emitido por Surtec venció')
        .uponReceiving('una emisión de e-Ticket con un token vencido')
        .withRequest('POST', '/comprobantes/crear', (b) => {
          b.headers({
            Authorization: `Bearer ${TOKEN_1}`,
            'X-Emisor': regex(RUT, RUT_EMISOR),
            'Content-Type': 'application/json',
          }).jsonBody(cuerpoETicket());
        })
        .willRespondWith(401);
      renovacionConRefresh(pact.addInteraction());
      await pact
        .addInteraction()
        .given('el emisor está habilitado en Surtec para emitir e-Tickets')
        .uponReceiving('la misma emisión de e-Ticket con el token renovado')
        .withRequest('POST', '/comprobantes/crear', (b) => {
          b.headers({
            Authorization: `Bearer ${TOKEN_2}`,
            'X-Emisor': regex(RUT, RUT_EMISOR),
            'Content-Type': 'application/json',
          }).jsonBody(cuerpoETicket());
        })
        .willRespondWith(200, (b) => {
          b.jsonBody(RESPUESTA_ETICKET);
        })
        .executeTest(async (mock) => {
          const cfe = await clienteContra(mock.url).emitirETicket(SOLICITUD);

          expect(cfe.numero).toBe(49);
        });
    });

    it('[TC-C-014] Surtec CFE: POST /comprobantes/crear con una sucursal que el emisor no tiene responde 4xx y BistroLink lanza SurtecError con el status', async () => {
      loginConUsuario(pact.addInteraction());
      await pact
        .addInteraction()
        .given('el emisor no tiene la sucursal 99 dada de alta en Surtec')
        .uponReceiving('una emisión de e-Ticket para una sucursal inexistente')
        .withRequest('POST', '/comprobantes/crear', (b) => {
          b.headers({
            Authorization: regex('^Bearer \\S+$', `Bearer ${TOKEN_1}`),
            'X-Emisor': regex(RUT, RUT_EMISOR),
            'Content-Type': 'application/json',
          }).jsonBody(cuerpoETicket(99));
        })
        // Solo el status: el cuerpo del error no se interpreta, se guarda
        // tal cual en el mensaje del SurtecError.
        .willRespondWith(400)
        .executeTest(async (mock) => {
          const client = clienteContra(mock.url);
          process.env.SURTEC_SUCURSAL = '99';

          const error = await client.emitirETicket(SOLICITUD).catch((e) => e);

          expect(error).toBeInstanceOf(SurtecError);
          expect(error.status).toBe(400);
          expect(error.message).not.toContain(CLAVE);
        });
    });
  });

  describe('POST /comprobantes/crear — emitir la e-Factura (HU-009, BL-453)', () => {
    it('[TC-C-015] Surtec CFE: POST /comprobantes/crear de una e-Factura (111) con el cliente (RUT y denominación) responde 200 con serie, número, hash, CAE y URL de DGI', async () => {
      loginConUsuario(pact.addInteraction());
      await pact
        .addInteraction()
        .given('el emisor está habilitado en Surtec para emitir e-Facturas')
        .uponReceiving('una emisión de e-Factura a un RUT que Surtec acepta')
        .withRequest('POST', '/comprobantes/crear', (b) => {
          b.headers({
            Authorization: regex('^Bearer \\S+$', `Bearer ${TOKEN_1}`),
            'X-Emisor': regex(RUT, RUT_EMISOR),
            'Content-Type': 'application/json',
          }).jsonBody(cuerpoEFactura());
        })
        .willRespondWith(200, (b) => {
          b.jsonBody(RESPUESTA_ETICKET);
        })
        .executeTest(async (mock) => {
          const cfe = await clienteContra(mock.url).emitirEFactura(
            SOLICITUD,
            RECEPTOR,
          );

          expect(cfe).toMatchObject({
            serie: 'A',
            numero: 49,
            caeNumero: '90191275538',
            url: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
          });
        });
    });

    it('[TC-C-016] Surtec CFE: POST /comprobantes/crear de una e-Factura a un RUT que DGI no tiene como contribuyente responde 4xx y BistroLink lanza SurtecError sin el RUT ni la razón social en el mensaje', async () => {
      loginConUsuario(pact.addInteraction());
      await pact
        .addInteraction()
        .given('el RUT del receptor no figura como contribuyente en DGI')
        .uponReceiving(
          'una emisión de e-Factura a un RUT que no es contribuyente',
        )
        .withRequest('POST', '/comprobantes/crear', (b) => {
          b.headers({
            Authorization: regex('^Bearer \\S+$', `Bearer ${TOKEN_1}`),
            'X-Emisor': regex(RUT, RUT_EMISOR),
            'Content-Type': 'application/json',
          }).jsonBody(cuerpoEFactura());
        })
        // Solo el status: con un 4xx, CfeService emite un e-Ticket.
        .willRespondWith(400)
        .executeTest(async (mock) => {
          const error = await clienteContra(mock.url)
            .emitirEFactura(SOLICITUD, RECEPTOR)
            .catch((e: unknown) => e);

          expect(error).toBeInstanceOf(SurtecError);
          expect((error as SurtecError).status).toBe(400);
          expect((error as SurtecError).message).not.toContain(RECEPTOR.rut);
          expect((error as SurtecError).message).not.toContain(
            RECEPTOR.razonSocial,
          );
        });
    });
  });

  describe('GET /consulta/comprobantes/emitidos — estado ante la DGI (HU-009, BL-455)', () => {
    const CONSULTA = {
      rutEmisor: RUT_EMISOR,
      fechaDesde: '2026-11-01',
      fechaHasta: '2026-11-03',
    };
    const FECHA = '^\\d{4}-\\d{2}-\\d{2}$';

    function consultaEmitidos(i: V4UnconfiguredInteraction) {
      return i.withRequest('GET', '/consulta/comprobantes/emitidos', (b) => {
        b.headers({
          Authorization: regex('^Bearer \\S+$', `Bearer ${TOKEN_1}`),
          'X-Emisor': regex(RUT, RUT_EMISOR),
        }).query({
          FechaDesde: regex(FECHA, '2026-11-01'),
          FechaHasta: regex(FECHA, '2026-11-03'),
          Sucursal: regex('^\\d+$', '1'),
        });
      });
    }

    it('[TC-C-017] Surtec CFE: GET /consulta/comprobantes/emitidos con un rango de fechas responde 200 con cada CFE (id, serie, número) y su estado ante la DGI', async () => {
      loginConUsuario(pact.addInteraction());
      await consultaEmitidos(
        pact
          .addInteraction()
          .given(
            'el emisor tiene CFE emitidos en el rango con respuesta de DGI',
          )
          .uponReceiving(
            'una consulta de los CFE emitidos en un rango de fechas',
          ),
      )
        // Nombres de la tabla de la guía de Surtec (`comprobante` y
        // `estado_dgi`); el ejemplo de la guía usa `comprobantes` y
        // `estado`. SurtecClient acepta los dos (leerEmitidos).
        .willRespondWith(200, (b) => {
          b.jsonBody({
            comprobante: eachLike({
              id: like(541759),
              serie: regex('^[A-Z]{1,2}$', 'A'),
              numero: like(49),
              estado_dgi: {
                codigo: regex('^(AE|BE|CE)$', 'AE'),
              },
            }),
          });
        })
        .executeTest(async (mock) => {
          const emitidos = await clienteContra(mock.url).consultarEmitidos(
            CONSULTA,
          );

          expect(emitidos).toEqual([
            {
              id: '541759',
              serie: 'A',
              numero: 49,
              codigoDgi: 'AE',
              motivoDgi: null,
            },
          ]);
        });
    });

    it('[TC-C-018] Surtec CFE: GET /consulta/comprobantes/emitidos sin CFE en el rango responde 200 con la lista vacía y BistroLink no actualiza nada', async () => {
      loginConUsuario(pact.addInteraction());
      await consultaEmitidos(
        pact
          .addInteraction()
          .given('el emisor no tiene CFE emitidos en el rango')
          .uponReceiving(
            'una consulta de CFE emitidos en un rango sin comprobantes',
          ),
      )
        .willRespondWith(200, (b) => {
          b.jsonBody({ comprobante: [] });
        })
        .executeTest(async (mock) => {
          await expect(
            clienteContra(mock.url).consultarEmitidos(CONSULTA),
          ).resolves.toEqual([]);
        });
    });
  });
});
