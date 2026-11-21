import {
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HEADER_SECRETO_WEBHOOK } from '../../src/whatsapp/configuracion-whatsapp';
import { BrokenCircuitError, TaskCancelledError } from 'cockatiel';
import {
  EvolutionClienteService,
  motivoDelFallo,
  TIMEOUT_EVOLUTION_MS,
} from '../../src/whatsapp/evolution-cliente.service';
import { WhatsappThrottlerGuard } from '../../src/whatsapp/whatsapp-throttler.guard';
import type { MensajeEntrante } from '../../src/whatsapp/mensaje-evolution';
import { WhatsappWebhookController } from '../../src/whatsapp/whatsapp-webhook.controller';
import {
  ACTOR_WHATSAPP,
  claveIdempotencia,
  estadoGuardado,
  MENSAJE_LOCAL_NO_DISPONIBLE,
  WhatsappService,
} from '../../src/whatsapp/whatsapp.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const RESTAURANTE = '22222222-2222-2222-2222-222222222222';
const MILANESA = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECRETO = 's'.repeat(40);
const AHORA = new Date('2026-11-21T15:00:00Z');

const ENTORNO = {
  EVOLUTION_API_URL: 'https://evo.test',
  EVOLUTION_API_KEY: 'clave-evo',
  EVOLUTION_INSTANCIAS: `bistrolink-staging=${TENANT}`,
  WHATSAPP_WEBHOOK_SECRETO: SECRETO,
  WHATSAPP_TELEFONO_CLAVE: 'k'.repeat(32),
  FRONTEND_URL: 'https://bistrolink.test/',
};

function mensaje(texto: string, mensajeId = `id-${texto}`): MensajeEntrante {
  return {
    instancia: 'bistrolink-staging',
    mensajeId,
    telefono: '598991234567',
    texto,
  };
}

function armar(conversacion: Record<string, unknown> | null = null) {
  const tx = {
    conversacionWhatsapp: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(conversacion),
      upsert: jest.fn().mockResolvedValue({}),
    },
    restaurante: {
      findUnique: jest.fn().mockResolvedValue({
        id: RESTAURANTE,
        nombre: 'La Cantina',
        timezone: 'America/Montevideo',
        retiroHabilitado: true,
        retiroHoraDesde: null,
        retiroHoraHasta: null,
      }),
    },
    categoriaCarta: {
      findMany: jest.fn().mockResolvedValue([
        {
          nombre: 'Platos',
          items: [
            {
              id: MILANESA,
              nombre: 'Milanesa',
              precio: new Prisma.Decimal('350.00'),
              disponible: true,
            },
          ],
        },
      ]),
    },
  };
  const tenantPrisma = {
    runInTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
      fn(tx),
    ),
  };
  const tenantEstado = { estaSuspendido: jest.fn().mockResolvedValue(false) };
  const pedidos = {
    crear: jest.fn().mockResolvedValue({ id: 'pedido-1' }),
  };
  const linkPago = {
    generar: jest.fn().mockResolvedValue({
      url: 'https://bistrolink.test/pagar/tok',
      venceEn: '2026-11-21T15:30:00.000Z',
    }),
  };
  const evolution = {
    enviar: jest.fn((_c, _i, _t, mensajes: string[]) =>
      Promise.resolve(mensajes.length),
    ),
  };
  const servicio = new WhatsappService(
    tenantPrisma as never,
    tenantEstado as never,
    pedidos as never,
    linkPago as never,
    evolution as never,
  );
  const enviados = () =>
    evolution.enviar.mock.calls.flatMap((llamada) => llamada[3]);
  return {
    servicio,
    tx,
    tenantEstado,
    pedidos,
    linkPago,
    evolution,
    enviados,
  };
}

function ultimo<T>(lista: T[]): T {
  return lista[lista.length - 1];
}

const CONFIRMANDO = {
  paso: 'CONFIRMAR',
  consentido: true,
  carrito: [{ itemCartaId: MILANESA, cantidad: 2 }],
  ultimoMensajeId: 'anterior',
};

describe('WhatsappService (HU-010, BL-112)', () => {
  const entornoOriginal = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, ENTORNO);
  });
  afterEach(() => {
    process.env = { ...entornoOriginal };
  });

  it('[TC-U-660] sin configuración o con una instancia desconocida no toca la base ni manda nada', async () => {
    const { servicio, tx, evolution } = armar();
    delete process.env.WHATSAPP_TELEFONO_CLAVE;
    expect(await servicio.procesar(mensaje('hola'), AHORA)).toBe('apagado');

    Object.assign(process.env, ENTORNO);
    expect(
      await servicio.procesar({ ...mensaje('hola'), instancia: 'otra' }, AHORA),
    ).toBe('instancia-desconocida');
    expect(tx.conversacionWhatsapp.findUnique).not.toHaveBeenCalled();
    expect(evolution.enviar).not.toHaveBeenCalled();
  });

  it('[TC-U-661] local suspendido: avisa que no toma pedidos y no lee la conversación', async () => {
    const { servicio, tx, tenantEstado, enviados } = armar();
    tenantEstado.estaSuspendido.mockResolvedValue(true);
    expect(await servicio.procesar(mensaje('hola'), AHORA)).toBe(
      'local-no-disponible',
    );
    expect(enviados()).toEqual([MENSAJE_LOCAL_NO_DISPONIBLE]);
    expect(tx.conversacionWhatsapp.findUnique).not.toHaveBeenCalled();
  });

  it('[TC-U-662] primer mensaje: borra las vencidas, guarda la conversación por el hash (sin el número) y manda el aviso de privacidad', async () => {
    const { servicio, tx, enviados } = armar();
    expect(await servicio.procesar(mensaje('hola', 'm1'), AHORA)).toBe(
      'respondido',
    );
    expect(tx.conversacionWhatsapp.deleteMany).toHaveBeenCalledWith({
      where: { venceEn: { lt: AHORA } },
    });
    const guardado = tx.conversacionWhatsapp.upsert.mock.calls[0][0];
    expect(guardado.create).toEqual(
      expect.objectContaining({
        tenantId: TENANT,
        paso: 'PRIVACIDAD',
        consentido: false,
        carrito: [],
        ultimoMensajeId: 'm1',
        venceEn: new Date('2026-11-21T15:30:00Z'),
      }),
    );
    expect(guardado.create.telefonoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(guardado)).not.toContain('598991234567');
    expect(enviados()[0]).toContain(
      `https://bistrolink.test/privacidad?t=${TENANT}&r=${RESTAURANTE}`,
    );
  });

  it('[TC-U-663] el mismo mensaje dos veces (Evolution reintenta) se procesa una sola', async () => {
    const { servicio, tx, evolution } = armar({
      ...CONFIRMANDO,
      ultimoMensajeId: 'repetido',
    });
    expect(await servicio.procesar(mensaje('1', 'repetido'), AHORA)).toBe(
      'repetido',
    );
    expect(tx.conversacionWhatsapp.upsert).not.toHaveBeenCalled();
    expect(evolution.enviar).not.toHaveBeenCalled();
  });

  it('[TC-U-664] al confirmar crea el pedido para retirar con canal WHATSAPP y el contacto, genera el link y vacía el carrito', async () => {
    const { servicio, tx, pedidos, linkPago, enviados } = armar(CONFIRMANDO);
    expect(await servicio.procesar(mensaje('1', 'conf'), AHORA)).toBe(
      'pedido-creado',
    );

    expect(pedidos.crear).toHaveBeenCalledWith(
      TENANT,
      {
        restauranteId: RESTAURANTE,
        idempotencyKey: claveIdempotencia(TENANT, 'conf'),
        items: [{ itemCartaId: MILANESA, cantidad: 2 }],
        contactoRetiro: {
          nombre: 'Pedido por WhatsApp',
          contacto: '+598991234567',
          consentimiento: true,
        },
      },
      undefined,
      'WHATSAPP',
    );
    expect(linkPago.generar).toHaveBeenCalledWith({
      tenantId: TENANT,
      keycloakId: ACTOR_WHATSAPP,
      pedidoId: 'pedido-1',
      reemplazar: true,
      ahora: AHORA,
    });
    const guardado = ultimo(tx.conversacionWhatsapp.upsert.mock.calls)[0];
    expect(guardado.update).toEqual(
      expect.objectContaining({
        paso: 'ARMANDO',
        consentido: true,
        carrito: [],
      }),
    );
    expect(ultimo(enviados())).toContain('https://bistrolink.test/pagar/tok');
    expect(ultimo(enviados())).toContain('12:30');
  });

  it('[TC-U-665] si el pedido se rechaza (409 del retiro o del stock) se dice el motivo y el carrito sigue', async () => {
    const { servicio, tx, pedidos, linkPago, enviados } = armar(CONFIRMANDO);
    pedidos.crear.mockRejectedValue(
      new ConflictException('No alcanza el stock de Milanesa'),
    );
    expect(await servicio.procesar(mensaje('1', 'conf'), AHORA)).toBe(
      'pedido-rechazado',
    );
    expect(linkPago.generar).not.toHaveBeenCalled();
    const guardado = ultimo(tx.conversacionWhatsapp.upsert.mock.calls)[0];
    expect(guardado.update).toEqual(
      expect.objectContaining({
        paso: 'ARMANDO',
        carrito: CONFIRMANDO.carrito,
      }),
    );
    expect(ultimo(enviados())).toContain(
      'No pudimos registrar el pedido: No alcanza el stock de Milanesa',
    );
  });

  it('[TC-U-666] un error interno no muestra detalles al comensal', async () => {
    const { servicio, linkPago, enviados } = armar(CONFIRMANDO);
    linkPago.generar.mockRejectedValue(
      new InternalServerErrorException('Falta FRONTEND_URL'),
    );
    expect(await servicio.procesar(mensaje('1', 'conf'), AHORA)).toBe(
      'pedido-rechazado',
    );
    expect(ultimo(enviados())).toBe(
      'Tuvimos un problema para registrar el pedido. Probá de nuevo en un momento.',
    );
  });

  it('[TC-U-670] si el tenant no tiene restaurante, avisa que el local no está disponible y no guarda nada', async () => {
    const { servicio, tx, enviados } = armar();
    tx.restaurante.findUnique.mockResolvedValue(null);
    expect(await servicio.procesar(mensaje('hola'), AHORA)).toBe(
      'local-no-disponible',
    );
    expect(tx.conversacionWhatsapp.upsert).not.toHaveBeenCalled();
    expect(enviados()).toEqual([MENSAJE_LOCAL_NO_DISPONIBLE]);
  });

  it('[TC-U-667] estadoGuardado es defensivo con lo que hay en la base y la clave de idempotencia cabe en la columna', () => {
    expect(
      estadoGuardado({
        paso: 'CONFIRMAR',
        consentido: true,
        carrito: [
          { itemCartaId: MILANESA, cantidad: 2 },
          { itemCartaId: 1, cantidad: 2 },
          { itemCartaId: 'x', cantidad: 0 },
          null,
        ],
      }),
    ).toEqual({
      paso: 'CONFIRMAR',
      consentido: true,
      carrito: [{ itemCartaId: MILANESA, cantidad: 2 }],
    });
    expect(
      estadoGuardado({ paso: 'RARO', consentido: false, carrito: 'x' }),
    ).toEqual({ paso: 'INICIO', consentido: false, carrito: [] });
    expect(
      estadoGuardado({ paso: 'PRIVACIDAD', consentido: false, carrito: [] })
        .paso,
    ).toBe('PRIVACIDAD');

    const clave = claveIdempotencia(TENANT, 'ABC');
    expect(clave.length).toBeLessThanOrEqual(64);
    expect(clave).not.toBe(
      claveIdempotencia('33333333-3333-3333-3333-333333333333', 'ABC'),
    );
  });
});

describe('WhatsappWebhookController (HU-010, BL-112)', () => {
  const entornoOriginal = { ...process.env };
  afterEach(() => {
    process.env = { ...entornoOriginal };
  });

  function controlador() {
    const whatsapp = {
      configuracion: jest.fn(() =>
        new WhatsappService(
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        ).configuracion(),
      ),
      procesar: jest.fn().mockResolvedValue('respondido'),
    };
    return {
      whatsapp,
      controller: new WhatsappWebhookController(whatsapp as never),
    };
  }

  const cuerpo = {
    event: 'messages.upsert',
    instance: 'bistrolink-staging',
    data: {
      key: {
        remoteJid: '598991234567@s.whatsapp.net',
        fromMe: false,
        id: 'A1',
      },
      message: { conversation: 'hola' },
    },
  };

  it('[TC-U-668] el webhook rechaza con 401 sin el secreto correcto o con el bot apagado, y con el secreto responde 200 aunque falle el proceso', async () => {
    expect(HEADER_SECRETO_WEBHOOK).toBe('x-bistrolink-webhook-secreto');
    const { controller, whatsapp } = controlador();

    await expect(controller.recibir(SECRETO, cuerpo)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    Object.assign(process.env, ENTORNO);
    await expect(controller.recibir('otro', cuerpo)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.recibir(undefined, cuerpo)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(whatsapp.procesar).not.toHaveBeenCalled();

    await expect(controller.recibir(SECRETO, cuerpo)).resolves.toEqual({
      ok: true,
    });
    expect(whatsapp.procesar).toHaveBeenCalledWith(
      expect.objectContaining({ mensajeId: 'A1', texto: 'hola' }),
    );

    // Un evento que no es un mensaje: 200 sin procesar.
    whatsapp.procesar.mockClear();
    await expect(
      controller.recibir(SECRETO, { event: 'connection.update' }),
    ).resolves.toEqual({ ok: true });
    expect(whatsapp.procesar).not.toHaveBeenCalled();

    // Si el proceso falla, igual 200 (Evolution no reintenta).
    whatsapp.procesar.mockRejectedValue(new Error('base caída'));
    await expect(controller.recibir(SECRETO, cuerpo)).resolves.toEqual({
      ok: true,
    });
  });
});

describe('EvolutionClienteService (HU-010, BL-112)', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  const config = {
    evolutionUrl: 'https://evo.test',
    evolutionApiKey: 'clave-evo',
    instancias: new Map(),
    secretoWebhook: SECRETO,
    claveTelefono: 'k'.repeat(32),
  };

  it('[TC-U-669] manda cada texto a sendText con la API key y corta en el primer fallo sin loguear el número', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    global.fetch = fetchMock as never;
    const servicio = new EvolutionClienteService();
    const warn = jest
      .spyOn(
        (servicio as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    const enviados = await servicio.enviar(
      config,
      'bistrolink-staging',
      '598991234567',
      ['uno', 'dos', 'tres'],
    );

    expect(enviados).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe('https://evo.test/message/sendText/bistrolink-staging');
    expect(opciones.method).toBe('POST');
    expect(opciones.headers.apikey).toBe('clave-evo');
    expect(JSON.parse(opciones.body)).toEqual({
      number: '598991234567',
      text: 'uno',
    });
    const log = String(warn.mock.calls[0][0]);
    expect(log).toContain('***567');
    expect(log).not.toContain('598991234567');
    expect(log).not.toContain('dos');
  });
});

describe('WhatsApp: rate limiting y motivos de fallo (HU-010, BL-112)', () => {
  it('[TC-U-671] el rate limiting cuenta por chat con un hash (nunca el número) y los eventos sin chat comparten un cupo', async () => {
    const guard = Object.create(
      WhatsappThrottlerGuard.prototype,
    ) as WhatsappThrottlerGuard;
    const tracker = (body: unknown) =>
      (
        guard as unknown as {
          getTracker: (req: Record<string, unknown>) => Promise<string>;
        }
      ).getTracker({ body });

    const uno = await tracker({
      data: { key: { remoteJid: '598991234567@s.whatsapp.net' } },
    });
    const otro = await tracker({
      data: { key: { remoteJid: '598997654321@s.whatsapp.net' } },
    });
    expect(uno).toMatch(/^whatsapp:[0-9a-f]{64}$/);
    expect(uno).not.toContain('598991234567');
    expect(otro).not.toBe(uno);
    expect(
      await tracker({
        data: { key: { remoteJid: '598991234567@s.whatsapp.net' } },
      }),
    ).toBe(uno);
    expect(await tracker({ event: 'connection.update' })).toBe(
      'whatsapp:sin-chat',
    );
    expect(await tracker(undefined)).toBe('whatsapp:sin-chat');
    expect(await tracker({ data: { key: { remoteJid: '' } } })).toBe(
      'whatsapp:sin-chat',
    );
  });

  it('[TC-U-672] el log de un envío fallido dice si fue el circuito abierto, el timeout o el error', () => {
    expect(motivoDelFallo(new BrokenCircuitError())).toBe('circuito abierto');
    expect(motivoDelFallo(new TaskCancelledError())).toBe(
      `sin respuesta en ${TIMEOUT_EVOLUTION_MS} ms`,
    );
    expect(motivoDelFallo(new Error('Evolution respondió 500'))).toBe(
      'Evolution respondió 500',
    );
    expect(motivoDelFallo({ numero: '598991234567' })).toBe(
      'error desconocido',
    );
  });
});
