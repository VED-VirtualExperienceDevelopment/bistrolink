import { SurtecClient, SurtecError } from '../../src/cfe/surtec.client';

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
});
