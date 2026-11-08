import {
  cuerpoParaLog,
  leerEmitido,
  listaDeEmitidos,
  leerPdf,
  SurtecClient,
  SurtecError,
} from '../../src/cfe/surtec.client';

const RESPUESTA_CFE = {
  id: 541759,
  serie: 'A',
  numero: 49,
  hash: 'YuFjLi8FhjlpqbniSfBS0OfmpPFErwiODpihtMqCyYs=',
  cae_numero: 90191275538,
  cae_vencimiento: '2030-12-31T00:00:00',
  url: 'https://www.efactura.dgi.gub.uy/consultaQR/cfe?x',
};

const SOLICITUD = {
  rutEmisor: '214198620015',
  idExterno: 'bl-pago-1',
  items: [{ concepto: 'Milanesa', cantidad: 1, precio: 590 }],
  adenda: 'Pedido 1',
};

function json(cuerpo: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(cuerpo),
  });
}

describe('SurtecClient', () => {
  let fetchMock: jest.Mock;
  let client: SurtecClient;

  beforeEach(() => {
    process.env.SURTEC_USER = 'usuario';
    process.env.SURTEC_PASSWORD = 'secreta';
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    client = new SurtecClient();
  });

  afterEach(() => {
    delete process.env.SURTEC_USER;
    delete process.env.SURTEC_PASSWORD;
    delete process.env.SURTEC_SUCURSAL;
    delete process.env.SURTEC_AUTH_URL;
    delete process.env.SURTEC_API_URL;
  });

  it('configurado() depende de usuario y contraseña', () => {
    expect(client.configurado()).toBe(true);
    delete process.env.SURTEC_PASSWORD;
    expect(client.configurado()).toBe(false);
  });

  it('emite un eTicket: login con usuario y contraseña, X-Emisor y precios con IVA incluido', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT', refresh_token: 'RT' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    const cfe = await client.emitirETicket(SOLICITUD);

    const [urlToken, optsToken] = fetchMock.mock.calls[0];
    expect(urlToken).toMatch(/\/token$/);
    expect(JSON.parse(optsToken.body)).toEqual({
      grant_type: 'password',
      username: 'usuario',
      password: 'secreta',
    });

    const [urlCfe, optsCfe] = fetchMock.mock.calls[1];
    expect(urlCfe).toMatch(/\/comprobantes\/crear$/);
    expect(optsCfe.headers).toMatchObject({
      Authorization: 'Bearer AT',
      'X-Emisor': '214198620015',
    });
    expect(JSON.parse(optsCfe.body)).toEqual({
      sucursal: 1,
      tipo_comprobante: 101,
      forma_pago: 1,
      moneda: 'UYU',
      cod_montos_brutos: 1,
      id_externo: 'bl-pago-1',
      items: [
        {
          cantidad: 1,
          concepto: 'Milanesa',
          precio: 590,
          indicador_facturacion: 3,
          unidad: 'Un',
        },
      ],
      adenda: { texto: 'Pedido 1' },
    });
    expect(cfe).toEqual({
      id: '541759',
      serie: 'A',
      numero: 49,
      hash: RESPUESTA_CFE.hash,
      caeNumero: '90191275538',
      caeVencimiento: new Date('2030-12-31T00:00:00'),
      url: RESPUESTA_CFE.url,
    });
  });

  it('lee SURTEC_AUTH_URL y SURTEC_API_URL en cada llamada, no al cargar el módulo', async () => {
    process.env.SURTEC_AUTH_URL = 'http://auth.local';
    process.env.SURTEC_API_URL = 'http://api.local';
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    await client.emitirETicket(SOLICITUD);

    expect(fetchMock.mock.calls[0][0]).toBe('http://auth.local/token');
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://api.local/comprobantes/crear',
    );
  });

  it('usa la sucursal configurada y no manda adenda si no hay', async () => {
    process.env.SURTEC_SUCURSAL = '2';
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    await client.emitirETicket({ ...SOLICITUD, adenda: undefined });

    const cuerpo = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(cuerpo.sucursal).toBe(2);
    expect(cuerpo).not.toHaveProperty('adenda');
  });

  it('una respuesta sin CAE ni vencimiento ni URL igual es válida', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(json({ id: 1, serie: 'A', numero: 2 }));

    const cfe = await client.emitirETicket(SOLICITUD);

    expect(cfe).toMatchObject({ serie: 'A', numero: 2 });
    expect(cfe.caeNumero).toBeUndefined();
    expect(cfe.caeVencimiento).toBeUndefined();
  });

  it('reutiliza el token mientras no venza (un solo login para dos emisiones)', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    await client.emitirETicket(SOLICITUD);
    await client.emitirETicket(SOLICITUD);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('con el token vencido lo renueva con el refresh token', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT', refresh_token: 'RT' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE))
      .mockReturnValueOnce(json({ access_token: 'AT2', refresh_token: 'RT2' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    await client.emitirETicket(SOLICITUD);
    (client as any).venceEn = 0; // simula el paso de las horas
    await client.emitirETicket(SOLICITUD);

    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'RT',
    });
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer AT2');
  });

  it('si el refresh token falla, vuelve a entrar con usuario y contraseña', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT', refresh_token: 'RT' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE))
      .mockReturnValueOnce(json({ error: 'invalid_grant' }, 400))
      .mockReturnValueOnce(json({ access_token: 'AT3' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    await client.emitirETicket(SOLICITUD);
    (client as any).venceEn = 0;
    await client.emitirETicket(SOLICITUD);

    expect(JSON.parse(fetchMock.mock.calls[3][1].body).grant_type).toBe(
      'password',
    );
  });

  it('un 401 en la emisión pide un token nuevo y reintenta una sola vez', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'VIEJO' }))
      .mockReturnValueOnce(json({}, 401))
      .mockReturnValueOnce(json({ access_token: 'NUEVO' }))
      .mockReturnValueOnce(json(RESPUESTA_CFE));

    const cfe = await client.emitirETicket(SOLICITUD);

    expect(cfe.numero).toBe(49);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe(
      'Bearer NUEVO',
    );
  });

  it('un segundo 401 seguido no entra en un bucle: falla', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'A' }))
      .mockReturnValueOnce(json({}, 401))
      .mockReturnValueOnce(json({ access_token: 'B' }))
      .mockReturnValueOnce(json({}, 401));

    await expect(client.emitirETicket(SOLICITUD)).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('sin credenciales configuradas falla sin llamar a la red', async () => {
    delete process.env.SURTEC_USER;

    await expect(client.emitirETicket(SOLICITUD)).rejects.toThrow(
      'no configurados',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('credenciales rechazadas => error, y la contraseña no aparece en el mensaje', async () => {
    fetchMock.mockReturnValueOnce(json({ error: 'invalid_grant' }, 400));

    const error = await client.emitirETicket(SOLICITUD).catch((e) => e);

    expect(error).toBeInstanceOf(SurtecError);
    expect(error.message).not.toContain('secreta');
  });

  it('un token sin access_token se trata como rechazado', async () => {
    fetchMock.mockReturnValueOnce(json({}));

    await expect(client.emitirETicket(SOLICITUD)).rejects.toThrow(
      'no aceptó las credenciales',
    );
  });

  it('Surtec rechaza la emisión (400) => SurtecError con el estado y el detalle', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(json({ message: 'emisor no válido' }, 400));

    const error = await client.emitirETicket(SOLICITUD).catch((e) => e);

    expect(error).toBeInstanceOf(SurtecError);
    expect(error.status).toBe(400);
    expect(error.message).toContain('emisor no válido');
  });

  it('respuesta sin serie o número => error', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(json({ id: 1 }));

    await expect(client.emitirETicket(SOLICITUD)).rejects.toThrow(
      'sin serie o número',
    );
  });

  it('una respuesta que no es JSON se trata como cuerpo vacío', async () => {
    fetchMock
      .mockReturnValueOnce(json({ access_token: 'AT' }))
      .mockReturnValueOnce(
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error('no es json')),
        }),
      );

    await expect(client.emitirETicket(SOLICITUD)).rejects.toMatchObject({
      status: 502,
    });
  });

  describe('HU-009 (BL-453): e-Factura', () => {
    const RECEPTOR = {
      rut: '219999830019',
      razonSocial: 'Comensal Ejemplo SAS',
    };

    it('emite una e-Factura (111) con el cliente: RUT (tipo_doc 2), país UY, número y denominación', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(json(RESPUESTA_CFE));

      const cfe = await client.emitirEFactura(SOLICITUD, RECEPTOR);

      const cuerpo = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(cuerpo).toMatchObject({
        tipo_comprobante: 111,
        forma_pago: 1,
        moneda: 'UYU',
        cod_montos_brutos: 1,
        id_externo: 'bl-pago-1',
        cliente: {
          tipo_doc: 2,
          cod_pais_doc: 'UY',
          nro_doc: '219999830019',
          denominacion: 'Comensal Ejemplo SAS',
        },
        adenda: { texto: 'Pedido 1' },
      });
      expect(cfe.serie).toBe('A');
    });

    it('el e-Ticket no lleva cliente', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(json(RESPUESTA_CFE));

      await client.emitirETicket(SOLICITUD);

      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty(
        'cliente',
      );
    });

    it('si Surtec rechaza y repite el cliente en la respuesta, el error no lleva el RUT ni la razón social', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(
          json(
            {
              mensaje: 'El receptor no es contribuyente',
              cliente: {
                nro_doc: RECEPTOR.rut,
                denominacion: RECEPTOR.razonSocial,
              },
            },
            400,
          ),
        );

      const error = await client
        .emitirEFactura(SOLICITUD, RECEPTOR)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SurtecError);
      expect((error as SurtecError).status).toBe(400);
      expect((error as SurtecError).message).toContain('no es contribuyente');
      expect((error as SurtecError).message).not.toContain(RECEPTOR.rut);
      expect((error as SurtecError).message).not.toContain(
        RECEPTOR.razonSocial,
      );
    });

    it('cuerpoParaLog oculta nro_doc y denominacion en cualquier nivel', () => {
      expect(
        cuerpoParaLog({
          errores: [{ nro_doc: '1', denominacion: 'X', campo: 'y' }],
        }),
      ).toBe(
        '{"errores":[{"nro_doc":"[oculto]","denominacion":"[oculto]","campo":"y"}]}',
      );
    });
  });

  describe('HU-024 (BL-104): nota de crédito', () => {
    const REFERENCIA = {
      tipoComprobante: 101,
      serie: 'A',
      numero: 49,
      fecha: '2026-11-07',
      razon: 'Cancelación del pedido',
    };

    it('de un e-Ticket: tipo 102, sin cliente y con la referencia específica al CFE original', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(json(RESPUESTA_CFE));

      await client.emitirNotaDeCredito(SOLICITUD, REFERENCIA);

      const cuerpo = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(cuerpo).toMatchObject({
        tipo_comprobante: 102,
        id_externo: 'bl-pago-1',
        items: [{ cantidad: 1, concepto: 'Milanesa', precio: 590 }],
        referencias: [
          {
            tipo_comprobante: 101,
            serie: 'A',
            numero: 49,
            fecha: '2026-11-07',
            razon: 'Cancelación del pedido',
          },
        ],
      });
      expect(cuerpo).not.toHaveProperty('cliente');
    });

    it('de una e-Factura: tipo 112 con el mismo receptor', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(json(RESPUESTA_CFE));

      await client.emitirNotaDeCredito(
        SOLICITUD,
        { ...REFERENCIA, tipoComprobante: 111 },
        { rut: '219999830019', razonSocial: 'Comensal Ejemplo SAS' },
      );

      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
        tipo_comprobante: 112,
        cliente: { tipo_doc: 2, nro_doc: '219999830019' },
        referencias: [{ tipo_comprobante: 111 }],
      });
    });

    it('de una e-Factura sin receptor (anonimizado): error sin llamar a Surtec', async () => {
      await expect(
        client.emitirNotaDeCredito(SOLICITUD, {
          ...REFERENCIA,
          tipoComprobante: 111,
        }),
      ).rejects.toBeInstanceOf(SurtecError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('la razón va cortada a 90 caracteres', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(json(RESPUESTA_CFE));

      await client.emitirNotaDeCredito(SOLICITUD, {
        ...REFERENCIA,
        razon: 'x'.repeat(120),
      });

      expect(
        JSON.parse(fetchMock.mock.calls[1][1].body).referencias[0].razon,
      ).toHaveLength(90);
    });
  });

  describe('HU-009 (BL-471): consulta de emitidos con la API v2', () => {
    const RUT = '214198620015';

    it('por id: GET /v2/consulta/comprobantes/emitidos/{id} con X-Emisor, sin cuerpo', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(
          json({
            id: 541759,
            serie: 'A',
            numero: 49,
            estado_dgi: { codigo: 'AE' },
          }),
        );

      const emitido = await client.consultarEmitido(RUT, '541759');

      const [url, opts] = fetchMock.mock.calls[1];
      expect(new URL(url).pathname).toBe(
        '/v2/consulta/comprobantes/emitidos/541759',
      );
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
      expect(opts.headers).toEqual({
        Authorization: 'Bearer AT',
        'X-Emisor': RUT,
      });
      expect(emitido).toEqual({
        id: '541759',
        serie: 'A',
        numero: 49,
        codigoDgi: 'AE',
        motivoDgi: null,
      });
    });

    it('por id: si Surtec no lo tiene (404) devuelve null; otro error lanza SurtecError sin datos del receptor', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(json({ mensaje: 'No encontrado' }, 404))
        .mockReturnValueOnce(
          json({ receptor: { nro_doc: '219999830019' } }, 503),
        );

      await expect(client.consultarEmitido(RUT, '1')).resolves.toBeNull();
      const error = await client
        .consultarEmitido(RUT, '2')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(SurtecError);
      expect((error as SurtecError).status).toBe(503);
      expect((error as SurtecError).message).toContain('la consulta');
      expect((error as SurtecError).message).not.toContain('219999830019');
    });

    it('por id_externo: filtra con ?id_externo= y toma el que coincide', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(
          json({
            items: [
              {
                id: 1,
                id_externo: 'bl-otro',
                serie: 'A',
                numero: 1,
                estado_dgi: 'BE',
              },
              {
                id: 2,
                id_externo: 'bl-pago-1',
                serie: 'A',
                numero: 2,
                estado_dgi: 'ae',
              },
            ],
            page_number: 1,
            page_size: 25,
          }),
        );

      const emitido = await client.buscarEmitidoPorIdExterno(RUT, 'bl-pago-1');

      const consulta = new URL(fetchMock.mock.calls[1][0]);
      expect(consulta.pathname).toBe('/v2/consulta/comprobantes/emitidos');
      expect(Object.fromEntries(consulta.searchParams)).toEqual({
        id_externo: 'bl-pago-1',
      });
      expect(emitido).toMatchObject({ id: '2', numero: 2, codigoDgi: 'AE' });
    });

    it('por id_externo: si ninguno coincide (Surtec ignoró el filtro) devuelve null', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(
          json({
            items: [{ id: 1, id_externo: 'bl-otro', serie: 'A', numero: 1 }],
          }),
        );

      await expect(
        client.buscarEmitidoPorIdExterno(RUT, 'bl-pago-1'),
      ).resolves.toBeNull();
    });
  });

  describe('leerEmitido y listaDeEmitidos (BL-455, BL-471)', () => {
    it('estado como objeto (detalle v2 y v1) o como texto (listado v2), también en `estado`', () => {
      expect(
        leerEmitido({
          id: 1,
          serie: 'A',
          numero: 1,
          estado_dgi: { codigo: 'be', razon: 'Firma inválida' },
        }),
      ).toEqual({
        id: '1',
        serie: 'A',
        numero: 1,
        codigoDgi: 'BE',
        motivoDgi: 'Firma inválida',
      });
      expect(
        leerEmitido({ id: 2, serie: 'A', numero: 2, estado_dgi: ' ce ' }),
      ).toMatchObject({
        codigoDgi: 'CE',
        motivoDgi: null,
      });
      expect(
        leerEmitido({
          id: 3,
          serie: 'A',
          numero: 3,
          estado: { codigo: 'AE', motivo: 'Recibido' },
        }),
      ).toMatchObject({ codigoDgi: 'AE', motivoDgi: 'Recibido' });
      expect(
        leerEmitido({
          id: 4,
          serie: 'A',
          numero: 4,
          estado_dgi: { descripcion: ' ' },
        }),
      ).toMatchObject({ codigoDgi: null, motivoDgi: null });
    });

    it('sin estado: DGI todavía no respondió', () => {
      expect(leerEmitido({ id: 1, serie: 'A', numero: 1 })).toMatchObject({
        codigoDgi: null,
        motivoDgi: null,
      });
    });

    it('sin id, serie o número, null', () => {
      expect(leerEmitido({ serie: 'A', numero: 1 })).toBeNull();
      expect(leerEmitido({ id: 1, numero: 1 })).toBeNull();
      expect(leerEmitido({ id: 1, serie: 'A' })).toBeNull();
      expect(leerEmitido(null)).toBeNull();
    });

    it('la lista sale de `items` (v2), `comprobantes` o `comprobante` (v1), o de un array', () => {
      const uno = { id: 1 };
      expect(listaDeEmitidos({ items: [uno] })).toEqual([uno]);
      expect(listaDeEmitidos({ comprobantes: [uno] })).toEqual([uno]);
      expect(listaDeEmitidos({ comprobante: [uno] })).toEqual([uno]);
      expect(listaDeEmitidos([uno])).toEqual([uno]);
      expect(listaDeEmitidos({ items: 'x' })).toEqual([]);
      expect(listaDeEmitidos(null)).toEqual([]);
    });
  });

  describe('HU-009 (BL-454): PDF del CFE', () => {
    const PDF = Buffer.from('%PDF-1.4 contenido de prueba');

    it('GET /comprobantes/{id}/pdf con X-Emisor; devuelve el PDF decodificado', async () => {
      fetchMock
        .mockReturnValueOnce(json({ access_token: 'AT' }))
        .mockReturnValueOnce(
          json({
            file_name: 'cfe.pdf',
            mime_type: 'application/pdf',
            format: 'A4',
            data: PDF.toString('base64'),
          }),
        );

      const { contenido } = await client.obtenerPdf('214198620015', '542442');

      const [url, opts] = fetchMock.mock.calls[1];
      expect(new URL(url).pathname).toBe('/comprobantes/542442/pdf');
      expect(opts.method).toBe('GET');
      expect(opts.headers['X-Emisor']).toBe('214198620015');
      expect(contenido.equals(PDF)).toBe(true);
    });

    it.each([
      [{ mime_type: 'text/html', data: PDF.toString('base64') }, /no es PDF/],
      [{ mime_type: 'application/pdf', data: '' }, /vacío/],
      [{ mime_type: 'application/pdf' }, /vacío/],
      [
        {
          mime_type: 'application/pdf',
          data: Buffer.from('<html>').toString('base64'),
        },
        /no es PDF/,
      ],
    ])('rechaza %p', (datos, mensaje) => {
      expect(() => leerPdf(datos)).toThrow(mensaje);
    });

    it('rechaza un PDF de más de 10 MB', () => {
      const grande = Buffer.concat([
        Buffer.from('%PDF-'),
        Buffer.alloc(10 * 1024 * 1024),
      ]);
      expect(() =>
        leerPdf({
          mime_type: 'application/pdf',
          data: grande.toString('base64'),
        }),
      ).toThrow(/tamaño máximo/);
    });
  });
});
