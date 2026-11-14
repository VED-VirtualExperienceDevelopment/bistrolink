import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import {
  hashNonceLinkPago,
  leerLinkPago,
  nonceCoincide,
  nuevoLinkPago,
  olvidarClaveLinkPago,
} from '../../src/link-pago/link-pago-token';
import {
  CODIGO_LINK_ACTIVO,
  CODIGO_LINK_CADUCADO,
  CODIGO_LINK_CANCELADO,
  CODIGO_LINK_REEMPLAZADO,
  CODIGO_LINK_VENCIDO,
  codigoDelLink,
  estadoDelLink,
  HEADER_LINK_PAGO,
  hayLinkVigente,
  linkPermite,
  MENSAJE_LINK_ACTIVO,
  MENSAJE_LINK_CADUCADO,
  MENSAJE_LINK_INVALIDO,
  MENSAJE_LINK_REEMPLAZADO,
  MENSAJE_LINK_VENCIDO,
  MENSAJE_NO_ESPERA_PAGO,
  MENSAJE_PAGO_EN_CURSO,
  mensajeDelLink,
  PLAZO_CONSULTA_LINK_MS,
  sinBarraFinal,
  venceEn,
} from '../../src/link-pago/link-pago';
import { LinkPagoThrottlerGuard } from '../../src/link-pago/link-pago-throttler.guard';
import { LinkPagoService } from '../../src/link-pago/link-pago.service';
import { LinkPagoController } from '../../src/link-pago/link-pago.controller';
import { PedidoAccesoGuard } from '../../src/pedidos/pedido-acceso.guard';
import { AuditAction } from '../../src/audit-log/audit-action.enum';
import { RolesGuard } from '../../src/auth/roles.guard';

// HU-033 (BL-203): link de pago que genera el mozo para un pedido pendiente.

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTRO_TENANT = '22222222-2222-4222-8222-222222222222';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const OTRO_PEDIDO = '44444444-4444-4444-8444-444444444444';
const RESTAURANTE = '55555555-5555-4555-8555-555555555555';
const ACTOR = '66666666-6666-4666-8666-666666666666';
const AHORA = new Date('2026-11-14T20:00:00.000Z');
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;

const claveAnterior = process.env.QR_TOKEN_KEY;
const frontendAnterior = process.env.FRONTEND_URL;

beforeAll(() => {
  process.env.QR_TOKEN_KEY = randomBytes(32).toString('base64');
  olvidarClaveLinkPago();
});

afterAll(() => {
  process.env.QR_TOKEN_KEY = claveAnterior;
  process.env.FRONTEND_URL = frontendAnterior;
  olvidarClaveLinkPago();
});

/** Un link y el pedido que lo tiene como vigente. */
function linkVigente(extra: Record<string, unknown> = {}) {
  const { token, hash } = nuevoLinkPago(TENANT, PEDIDO);
  return {
    token,
    pedido: {
      estado: 'PENDIENTE_PAGO',
      linkPagoHash: hash,
      linkPagoVenceEn: new Date(AHORA.getTime() + 10 * MINUTO),
      ...extra,
    },
  };
}

describe('token del link de pago', () => {
  it('se descifra con el tenant, el pedido y el nonce, y el hash coincide', () => {
    const { token, hash } = nuevoLinkPago(TENANT, PEDIDO);
    const datos = leerLinkPago(token);

    expect(datos).toMatchObject({ tenantId: TENANT, pedidoId: PEDIDO });
    expect(hashNonceLinkPago(datos!.nonce)).toBe(hash);
    expect(nonceCoincide(datos!.nonce, hash)).toBe(true);
  });

  it('es opaco: la URL no muestra los ids internos', () => {
    const { token } = nuevoLinkPago(TENANT, PEDIDO);
    for (const id of [TENANT, PEDIDO]) {
      expect(token).not.toContain(id);
      expect(token).not.toContain(id.replaceAll('-', ''));
    }
    expect(token).toMatch(/^[A-Za-z0-9_-]{103}$/);
  });

  it('cada link es distinto, aunque sea del mismo pedido', () => {
    const a = nuevoLinkPago(TENANT, PEDIDO);
    const b = nuevoLinkPago(TENANT, PEDIDO);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it('un token cambiado, cortado o de otro formato no vale (null)', () => {
    const { token } = nuevoLinkPago(TENANT, PEDIDO);
    const cambiado =
      token.slice(0, 50) + (token[50] === 'A' ? 'B' : 'A') + token.slice(51);
    for (const malo of [
      cambiado,
      token.slice(0, -1),
      `${token}x`,
      'no-es-un-link',
      '../admin',
      'x'.repeat(300),
      undefined,
      42,
    ]) {
      expect(leerLinkPago(malo)).toBeNull();
    }
  });

  it('con otra clave no se puede leer', () => {
    const { token } = nuevoLinkPago(TENANT, PEDIDO);
    const clave = process.env.QR_TOKEN_KEY;
    process.env.QR_TOKEN_KEY = randomBytes(32).toString('base64');
    olvidarClaveLinkPago();
    try {
      expect(leerLinkPago(token)).toBeNull();
    } finally {
      process.env.QR_TOKEN_KEY = clave;
      olvidarClaveLinkPago();
    }
  });

  it('sin hash guardado no coincide', () => {
    expect(nonceCoincide('nonce', null)).toBe(false);
  });
});

describe('estado del link', () => {
  it('vigente: es el del pedido, sin vencer y el pedido espera el pago', () => {
    const { token, pedido } = linkVigente();
    const { nonce } = leerLinkPago(token)!;
    expect(estadoDelLink(pedido, nonce, AHORA)).toBe('vigente');
  });

  it.each([
    ['vencido', { linkPagoVenceEn: new Date(AHORA.getTime() - 1) }],
    ['vencido', { linkPagoVenceEn: AHORA }],
    ['pagado', { estado: 'RECIBIDO' }],
    ['pagado', { estado: 'ENTREGADO' }],
    ['cancelado', { estado: 'CANCELADO' }],
  ])('%s', (esperado, cambio) => {
    const { token, pedido } = linkVigente(cambio);
    const { nonce } = leerLinkPago(token)!;
    expect(estadoDelLink(pedido, nonce, AHORA)).toBe(esperado);
  });

  it('reemplazado: el pedido tiene otro link', () => {
    const { token, pedido } = linkVigente();
    const nuevo = nuevoLinkPago(TENANT, PEDIDO);
    const { nonce } = leerLinkPago(token)!;
    expect(
      estadoDelLink({ ...pedido, linkPagoHash: nuevo.hash }, nonce, AHORA),
    ).toBe('reemplazado');
  });

  it('caducado: pasado el plazo de consulta (24 h desde que venció) no sirve ni para mirar', () => {
    expect(PLAZO_CONSULTA_LINK_MS).toBe(24 * HORA);
    const vencio = new Date(AHORA.getTime() - PLAZO_CONSULTA_LINK_MS);
    for (const estado of ['RECIBIDO', 'ENTREGADO', 'PENDIENTE_PAGO']) {
      const { token, pedido } = linkVigente({
        estado,
        linkPagoVenceEn: vencio,
      });
      const { nonce } = leerLinkPago(token)!;
      expect(estadoDelLink(pedido, nonce, AHORA)).toBe('caducado');
    }
    // Un minuto antes del plazo, el pedido pagado todavía se puede consultar.
    const { token, pedido } = linkVigente({
      estado: 'RECIBIDO',
      linkPagoVenceEn: new Date(vencio.getTime() + MINUTO),
    });
    const { nonce } = leerLinkPago(token)!;
    expect(estadoDelLink(pedido, nonce, AHORA)).toBe('pagado');
  });

  it('reemplazado y cancelado se informan aunque haya caducado', () => {
    const vencio = new Date(AHORA.getTime() - 2 * PLAZO_CONSULTA_LINK_MS);
    const { token, pedido } = linkVigente({ linkPagoVenceEn: vencio });
    const { nonce } = leerLinkPago(token)!;
    expect(
      estadoDelLink({ ...pedido, estado: 'CANCELADO' }, nonce, AHORA),
    ).toBe('cancelado');
    expect(
      estadoDelLink({ ...pedido, linkPagoHash: 'c'.repeat(64) }, nonce, AHORA),
    ).toBe('reemplazado');
  });

  it('hay un link vigente: guardado y sin vencer', () => {
    const { pedido } = linkVigente();
    expect(hayLinkVigente(pedido, AHORA)).toBe(true);
    expect(hayLinkVigente({ ...pedido, linkPagoVenceEn: AHORA }, AHORA)).toBe(
      false,
    );
    expect(
      hayLinkVigente({ linkPagoHash: null, linkPagoVenceEn: null }, AHORA),
    ).toBe(false);
  });

  it('pagar solo con el vigente; consultar también vencido o pagado', () => {
    expect(linkPermite('vigente', false)).toBe(true);
    expect(linkPermite('vencido', false)).toBe(false);
    expect(linkPermite('pagado', false)).toBe(false);
    expect(linkPermite('vencido', true)).toBe(true);
    expect(linkPermite('pagado', true)).toBe(true);
    expect(linkPermite('reemplazado', true)).toBe(false);
    expect(linkPermite('cancelado', true)).toBe(false);
    expect(linkPermite('caducado', true)).toBe(false);
    expect(linkPermite('caducado', false)).toBe(false);
  });

  it('códigos y mensajes para el comensal', () => {
    expect(codigoDelLink('vencido')).toBe(CODIGO_LINK_VENCIDO);
    expect(codigoDelLink('reemplazado')).toBe(CODIGO_LINK_REEMPLAZADO);
    expect(codigoDelLink('cancelado')).toBe(CODIGO_LINK_CANCELADO);
    expect(codigoDelLink('caducado')).toBe(CODIGO_LINK_CADUCADO);
    expect(mensajeDelLink('caducado')).toBe(MENSAJE_LINK_CADUCADO);
    expect(codigoDelLink('vigente')).toBeNull();
    expect(codigoDelLink('pagado')).toBeNull();
    expect(mensajeDelLink('vencido')).toBe(MENSAJE_LINK_VENCIDO);
    expect(mensajeDelLink('reemplazado')).toBe(MENSAJE_LINK_REEMPLAZADO);
    expect(mensajeDelLink('pagado')).toBe(MENSAJE_NO_ESPERA_PAGO);
  });

  it('vence sumando el plazo y la URL base va sin barra final', () => {
    expect(venceEn(AHORA, 15 * MINUTO).toISOString()).toBe(
      '2026-11-14T20:15:00.000Z',
    );
    expect(sinBarraFinal('https://app.example//')).toBe('https://app.example');
  });
});

describe('LinkPagoService', () => {
  let tx: any;
  let auditLog: { registrarEnTx: jest.Mock };
  let service: LinkPagoService;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example/';
    tx = {
      pedido: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    auditLog = { registrarEnTx: jest.fn() };
    service = new LinkPagoService(
      { runInTenantContext: jest.fn((_t, fn) => fn(tx)) } as any,
      auditLog as any,
    );
  });

  describe('generar', () => {
    const generar = (reemplazar?: boolean) =>
      service.generar({
        tenantId: TENANT,
        keycloakId: ACTOR,
        pedidoId: PEDIDO,
        reemplazar,
        ahora: AHORA,
      });
    /** 409 LINK_PAGO_ACTIVO: hay otro link y no se pidió reemplazarlo. */
    const esOtroLinkActivo = (e: unknown) =>
      e instanceof ConflictException &&
      JSON.stringify(e.getResponse()) ===
        JSON.stringify({
          statusCode: 409,
          codigo: CODIGO_LINK_ACTIVO,
          message: MENSAJE_LINK_ACTIVO,
        });

    it('guarda el hash y el vencimiento (plazo de HU-032), audita sin el link y devuelve la URL', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        estado: 'PENDIENTE_PAGO',
        linkPagoHash: null,
        linkPagoVenceEn: null,
        pagos: [],
      });

      const link = await generar();

      expect(link.url).toMatch(
        /^https:\/\/app\.example\/pagar\/[A-Za-z0-9_-]{103}$/,
      );
      expect(link.venceEn).toBe('2026-11-14T20:15:00.000Z');
      const token = link.url.split('/pagar/')[1];
      const datos = leerLinkPago(token)!;
      expect(datos).toMatchObject({ tenantId: TENANT, pedidoId: PEDIDO });
      // Solo si el pedido sigue como se leyó (sin link, esperando el pago).
      expect(tx.pedido.updateMany).toHaveBeenCalledWith({
        where: { id: PEDIDO, estado: 'PENDIENTE_PAGO', linkPagoHash: null },
        data: {
          linkPagoHash: hashNonceLinkPago(datos.nonce),
          linkPagoVenceEn: new Date('2026-11-14T20:15:00.000Z'),
        },
      });
      expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
        action: AuditAction.PEDIDO_LINK_PAGO_GENERADO,
        tenantId: TENANT,
        actorKeycloakId: ACTOR,
        entidad: 'pedido',
        entidadId: PEDIDO,
        detalle: { venceEn: link.venceEn, reemplazaOtro: false },
      });
      expect(JSON.stringify(auditLog.registrarEnTx.mock.calls)).not.toContain(
        token,
      );
    });

    it('con un link vigente y sin «reemplazar» (otro mozo, pantalla vieja): 409 LINK_PAGO_ACTIVO y no toca nada', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        estado: 'PENDIENTE_PAGO',
        linkPagoHash: 'a'.repeat(64),
        linkPagoVenceEn: new Date(AHORA.getTime() + 5 * MINUTO),
        pagos: [],
      });

      const error = await generar().catch((e) => e);

      expect(esOtroLinkActivo(error)).toBe(true);
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });

    it('con «reemplazar», lo reemplaza (comparando el link leído) y lo deja dicho en la auditoría', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        estado: 'PENDIENTE_PAGO',
        linkPagoHash: 'a'.repeat(64),
        linkPagoVenceEn: new Date(AHORA.getTime() + 5 * MINUTO),
        pagos: [],
      });

      await generar(true);

      expect(tx.pedido.updateMany.mock.calls[0][0].where).toEqual({
        id: PEDIDO,
        estado: 'PENDIENTE_PAGO',
        linkPagoHash: 'a'.repeat(64),
      });
      expect(auditLog.registrarEnTx.mock.calls[0][1].detalle).toMatchObject({
        reemplazaOtro: true,
      });
    });

    it('si el link anterior ya venció, genera otro sin pedir confirmación', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        estado: 'PENDIENTE_PAGO',
        linkPagoHash: 'a'.repeat(64),
        linkPagoVenceEn: AHORA,
        pagos: [],
      });

      await expect(generar()).resolves.toMatchObject({
        venceEn: '2026-11-14T20:15:00.000Z',
      });
    });

    it('dos colaboradores a la vez: si otro guardó un link entre la lectura y el guardado, 409 LINK_PAGO_ACTIVO y sin auditoría', async () => {
      tx.pedido.findUnique.mockResolvedValue({
        estado: 'PENDIENTE_PAGO',
        linkPagoHash: null,
        linkPagoVenceEn: null,
        pagos: [],
      });
      tx.pedido.updateMany.mockResolvedValue({ count: 0 });

      const error = await generar(true).catch((e) => e);

      expect(esOtroLinkActivo(error)).toBe(true);
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });

    it.each([
      [
        'no existe en el tenant: 404',
        null,
        NotFoundException,
        'Pedido no encontrado',
      ],
      [
        'ya no espera el pago: 409',
        { estado: 'RECIBIDO', linkPagoHash: null, pagos: [] },
        ConflictException,
        MENSAJE_NO_ESPERA_PAGO,
      ],
      [
        'con un pago en curso: 409',
        {
          estado: 'PENDIENTE_PAGO',
          linkPagoHash: null,
          pagos: [{ id: 'pago-1' }],
        },
        ConflictException,
        MENSAJE_PAGO_EN_CURSO,
      ],
    ])('%s', async (_caso, pedido, tipo, mensaje) => {
      tx.pedido.findUnique.mockResolvedValue(pedido);
      const intento = generar();
      await expect(intento).rejects.toBeInstanceOf(tipo);
      await expect(intento).rejects.toThrow(mensaje);
      expect(tx.pedido.updateMany).not.toHaveBeenCalled();
      expect(auditLog.registrarEnTx).not.toHaveBeenCalled();
    });

    it('sin FRONTEND_URL no genera nada (500)', async () => {
      delete process.env.FRONTEND_URL;
      await expect(generar()).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(tx.pedido.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolver', () => {
    it('link vigente: tenant, restaurante y pedido', async () => {
      const { token, pedido } = linkVigente();
      tx.pedido.findUnique.mockResolvedValue({
        ...pedido,
        restauranteId: RESTAURANTE,
      });

      await expect(service.resolver(token, AHORA)).resolves.toEqual({
        tenantId: TENANT,
        restauranteId: RESTAURANTE,
        pedidoId: PEDIDO,
      });
    });

    it('pedido ya pagado: sirve para ver el estado y el comprobante', async () => {
      const { token, pedido } = linkVigente({ estado: 'RECIBIDO' });
      tx.pedido.findUnique.mockResolvedValue({
        ...pedido,
        restauranteId: RESTAURANTE,
      });

      await expect(service.resolver(token, AHORA)).resolves.toMatchObject({
        pedidoId: PEDIDO,
      });
    });

    it('token inválido o pedido inexistente: 404', async () => {
      await expect(service.resolver('no-es-link', AHORA)).rejects.toThrow(
        new NotFoundException(MENSAJE_LINK_INVALIDO),
      );
      const { token } = linkVigente();
      tx.pedido.findUnique.mockResolvedValue(null);
      await expect(service.resolver(token, AHORA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([
      [CODIGO_LINK_VENCIDO, { linkPagoVenceEn: new Date(AHORA.getTime() - 1) }],
      [CODIGO_LINK_CANCELADO, { estado: 'CANCELADO' }],
      [CODIGO_LINK_REEMPLAZADO, { linkPagoHash: 'b'.repeat(64) }],
      [
        CODIGO_LINK_CADUCADO,
        {
          estado: 'RECIBIDO',
          linkPagoVenceEn: new Date(AHORA.getTime() - PLAZO_CONSULTA_LINK_MS),
        },
      ],
    ])('410 con el código %s', async (codigo, cambio) => {
      const { token, pedido } = linkVigente(cambio);
      tx.pedido.findUnique.mockResolvedValue({
        ...pedido,
        restauranteId: RESTAURANTE,
      });

      const error = await service.resolver(token, AHORA).catch((e) => e);
      expect(error).toBeInstanceOf(GoneException);
      expect(error.getResponse()).toMatchObject({ statusCode: 410, codigo });
    });
  });

  describe('resumen', () => {
    it('el pedido del link, con el consumo y sin datos del comensal', async () => {
      const { token, pedido } = linkVigente();
      tx.pedido.findUnique.mockResolvedValue({
        ...pedido,
        restauranteId: RESTAURANTE,
      });
      tx.pedido.findUniqueOrThrow.mockResolvedValue({
        id: PEDIDO,
        estado: 'PENDIENTE_PAGO',
        linkPagoVenceEn: pedido.linkPagoVenceEn,
        restaurante: { nombre: 'La Cantina' },
        mesa: { numero: 4, esVirtual: false },
        lineas: [
          {
            itemCartaId: 'item-1',
            nombreSnapshot: 'Milanesa',
            cantidad: 2,
            precioUnitarioSnapshot: new Prisma.Decimal('390'),
            subtotal: new Prisma.Decimal('780'),
          },
        ],
      });

      await expect(service.resumen(TENANT, token, AHORA)).resolves.toEqual({
        pedidoId: PEDIDO,
        estadoPedido: 'PENDIENTE_PAGO',
        restaurante: { nombre: 'La Cantina' },
        mesaNumero: 4,
        lineas: [
          {
            itemCartaId: 'item-1',
            nombre: 'Milanesa',
            cantidad: 2,
            precio: '390.00',
          },
        ],
        consumo: '780.00',
        venceEn: pedido.linkPagoVenceEn.toISOString(),
      });
    });

    it('pedido para retirar (mesa virtual): sin número de mesa', async () => {
      const { token, pedido } = linkVigente();
      tx.pedido.findUnique.mockResolvedValue({
        ...pedido,
        restauranteId: RESTAURANTE,
      });
      tx.pedido.findUniqueOrThrow.mockResolvedValue({
        id: PEDIDO,
        estado: 'PENDIENTE_PAGO',
        linkPagoVenceEn: pedido.linkPagoVenceEn,
        restaurante: { nombre: 'La Cantina' },
        mesa: { numero: 0, esVirtual: true },
        lineas: [],
      });

      const resumen = await service.resumen(TENANT, token, AHORA);
      expect(resumen.mesaNumero).toBeNull();
    });

    it('el JWT es de otro tenant: 403', async () => {
      const { token, pedido } = linkVigente();
      tx.pedido.findUnique.mockResolvedValue({
        ...pedido,
        restauranteId: RESTAURANTE,
      });

      await expect(
        service.resumen(OTRO_TENANT, token, AHORA),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

describe('PedidoAccesoGuard con el link de pago', () => {
  let findUnique: jest.Mock;
  let guard: PedidoAccesoGuard;

  const contexto = (request: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const request = (
    token: string,
    method: string,
    pedidoId: string = PEDIDO,
  ) => ({
    method,
    params: { pedidoId },
    headers: { [HEADER_LINK_PAGO]: token },
    user: { sub: 'comensal', tenantId: TENANT, roles: ['COMENSAL'] },
  });

  beforeEach(() => {
    findUnique = jest.fn();
    guard = new PedidoAccesoGuard({
      runInTenantContext: jest.fn((_t, fn) => fn({ pedido: { findUnique } })),
    } as any);
  });

  /** El pedido en la base, de cualquier canal (el link vale para todos). */
  function enLaBase(pedido: Record<string, unknown>) {
    findUnique.mockResolvedValue({
      mesaId: 'mesa',
      canal: 'MOZO',
      accesoTokenHash: null,
      createdAt: AHORA,
      ...pedido,
    });
  }

  it('link vigente: deja pagar y consultar, aunque el pedido sea de otro canal', async () => {
    const { token, pedido } = linkVigente({
      linkPagoVenceEn: new Date(Date.now() + 10 * MINUTO),
    });
    enLaBase(pedido);

    await expect(
      guard.canActivate(contexto(request(token, 'POST'))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contexto(request(token, 'GET'))),
    ).resolves.toBe(true);
  });

  it('link caducado (24 h después de vencer): no deja ni consultar el pedido pagado ni su comprobante', async () => {
    const { token, pedido } = linkVigente({
      estado: 'RECIBIDO',
      linkPagoVenceEn: new Date(Date.now() - PLAZO_CONSULTA_LINK_MS - MINUTO),
    });
    enLaBase(pedido);

    await expect(
      guard.canActivate(contexto(request(token, 'GET'))),
    ).rejects.toThrow(new ForbiddenException(MENSAJE_LINK_CADUCADO));
  });

  it('link vencido: no deja pagar (la pasarela no cobra), sí consultar', async () => {
    const { token, pedido } = linkVigente({
      linkPagoVenceEn: new Date(Date.now() - MINUTO),
    });
    enLaBase(pedido);

    await expect(
      guard.canActivate(contexto(request(token, 'POST'))),
    ).rejects.toThrow(new ForbiddenException(MENSAJE_LINK_VENCIDO));
    await expect(
      guard.canActivate(contexto(request(token, 'GET'))),
    ).resolves.toBe(true);
  });

  it('link reemplazado: ni pagar ni consultar', async () => {
    const { token, pedido } = linkVigente({
      linkPagoVenceEn: new Date(Date.now() + 10 * MINUTO),
    });
    enLaBase({ ...pedido, linkPagoHash: nuevoLinkPago(TENANT, PEDIDO).hash });

    for (const metodo of ['POST', 'GET']) {
      await expect(
        guard.canActivate(contexto(request(token, metodo))),
      ).rejects.toThrow(new ForbiddenException(MENSAJE_LINK_REEMPLAZADO));
    }
  });

  it('el link de un pedido no sirve para otro', async () => {
    const { token, pedido } = linkVigente({
      linkPagoVenceEn: new Date(Date.now() + 10 * MINUTO),
    });
    enLaBase(pedido);

    await expect(
      guard.canActivate(contexto(request(token, 'GET', OTRO_PEDIDO))),
    ).rejects.toThrow(new ForbiddenException(MENSAJE_LINK_INVALIDO));
  });

  it('un link de otro tenant no sirve', async () => {
    const { token } = nuevoLinkPago(OTRO_TENANT, PEDIDO);
    enLaBase({
      estado: 'PENDIENTE_PAGO',
      linkPagoHash: null,
      linkPagoVenceEn: null,
    });

    await expect(
      guard.canActivate(contexto(request(token, 'GET'))),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un link inventado no sirve', async () => {
    enLaBase({
      estado: 'PENDIENTE_PAGO',
      linkPagoHash: null,
      linkPagoVenceEn: null,
    });

    await expect(
      guard.canActivate(contexto(request('inventado', 'GET'))),
    ).rejects.toThrow(new ForbiddenException(MENSAJE_LINK_INVALIDO));
  });
});

describe('LinkPagoController', () => {
  const linkPago = { generar: jest.fn(), resumen: jest.fn() };
  const controller = new LinkPagoController(linkPago as any);

  it('genera con el tenant y el actor del JWT, nunca del body', async () => {
    const req = { user: { tenantId: TENANT, sub: ACTOR, roles: ['MOZO'] } };
    await controller.generar(req as any, PEDIDO, {});
    expect(linkPago.generar).toHaveBeenCalledWith({
      tenantId: TENANT,
      keycloakId: ACTOR,
      pedidoId: PEDIDO,
      reemplazar: false,
    });
  });

  it('reemplaza el link vigente solo si el body lo pide', async () => {
    const req = { user: { tenantId: TENANT, sub: ACTOR, roles: ['MOZO'] } };
    await controller.generar(req as any, PEDIDO, { reemplazar: true });
    expect(linkPago.generar).toHaveBeenLastCalledWith(
      expect.objectContaining({ reemplazar: true }),
    );
  });

  it('el resumen usa el tenant del JWT y el link del header; sin link, 404', async () => {
    const req = { user: { tenantId: TENANT, sub: 'c', roles: ['COMENSAL'] } };
    await controller.resumen(req as any, 'token');
    expect(linkPago.resumen).toHaveBeenCalledWith(TENANT, 'token');
    expect(() => controller.resumen(req as any, undefined)).toThrow(
      NotFoundException,
    );
  });

  const guard = new RolesGuard(new Reflector());
  /** RolesGuard responde 403 (excepción) si el rol no alcanza. */
  const puede = (handler: unknown, rol: string) => {
    try {
      return guard.canActivate({
        getHandler: () => handler,
        getClass: () => LinkPagoController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { roles: [rol] } }),
        }),
      } as unknown as ExecutionContext);
    } catch (e) {
      if (e instanceof ForbiddenException) return false;
      throw e;
    }
  };

  it('generar: solo ADMIN y MOZO (COCINA y el comensal no)', () => {
    const generar = LinkPagoController.prototype.generar;
    expect(puede(generar, 'ADMIN')).toBe(true);
    expect(puede(generar, 'MOZO')).toBe(true);
    expect(puede(generar, 'COCINA')).toBe(false);
    expect(puede(generar, 'COMENSAL')).toBe(false);
  });

  it('resumen: solo el comensal', () => {
    const resumen = LinkPagoController.prototype.resumen;
    expect(puede(resumen, 'COMENSAL')).toBe(true);
    expect(puede(resumen, 'MOZO')).toBe(false);
  });
});

describe('LinkPagoThrottlerGuard.getTracker', () => {
  const guard = Object.create(
    LinkPagoThrottlerGuard.prototype,
  ) as LinkPagoThrottlerGuard;
  const getTracker = (req: Record<string, any>): Promise<string> =>
    (guard as any).getTracker(req);

  it('cuenta por link (con el hash, nunca el token), no por IP', async () => {
    const { token } = nuevoLinkPago(TENANT, PEDIDO);
    const tracker = await getTracker({
      ip: '10.0.0.1',
      body: { linkToken: token },
    });

    expect(tracker).toMatch(/^link:[0-9a-f]{64}$/);
    expect(tracker).not.toContain(token);
  });

  it('dos links desde la misma IP tienen cupos distintos; el mismo link, el mismo', async () => {
    const a = nuevoLinkPago(TENANT, PEDIDO).token;
    const b = nuevoLinkPago(TENANT, PEDIDO).token;
    const ip = '10.0.0.1';

    expect(await getTracker({ ip, body: { linkToken: a } })).not.toBe(
      await getTracker({ ip, body: { linkToken: b } }),
    );
    expect(await getTracker({ ip: '10.0.0.2', body: { linkToken: a } })).toBe(
      await getTracker({ ip, body: { linkToken: a } }),
    );
  });

  it('sin token (body inválido) comparte un cupo propio', async () => {
    for (const body of [undefined, {}, { linkToken: 42 }, { linkToken: '' }]) {
      await expect(getTracker({ ip: '10.0.0.1', body })).resolves.toBe(
        'link:sin-token',
      );
    }
  });
});
