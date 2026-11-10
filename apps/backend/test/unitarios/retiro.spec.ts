import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CODIGO_RETIRO_NO_DISPONIBLE,
  ContactoRetiroDto,
  contactoRetiroParaGuardar,
  dentroDeLaFranja,
  formatearCodigoRetiro,
  horaLocal,
  mensajeRetiroNoDisponible,
  normalizarCodigoRetiro,
  normalizarContactoRetiro,
  retiroAbierto,
  retiroPublico,
} from '../../src/pedidos/retiro';
import { PedidosService } from '../../src/pedidos/pedidos.service';
import {
  MENSAJE_ENTREGA_CON_CODIGO,
  PedidosTransicionService,
} from '../../src/pedidos/pedidos-transicion.service';
import { PedidosController } from '../../src/pedidos/pedidos.controller';
import { EntregarRetiroDto } from '../../src/pedidos/dto/entregar-retiro.dto';
import { CrearPedidoDto } from '../../src/pedidos/dto/crear-pedido.dto';
import { AnonimizarRetiroService } from '../../src/configuracion/anonimizar-retiro.service';
import { AnonimizarRetiroDto } from '../../src/configuracion/dto/anonimizar-retiro.dto';
import { ActualizarConfiguracionDto } from '../../src/configuracion/dto/actualizar-configuracion.dto';
import { ConfiguracionEstablecimientoService } from '../../src/configuracion/configuracion-establecimiento.service';
import { AuditAction } from '../../src/audit-log/audit-action.enum';

// HU-040 (BL-210): pedido para retirar por el enlace web.

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const RESTAURANTE_ID = '22222222-2222-4222-8222-222222222222';
const PEDIDO_ID = '33333333-3333-4333-8333-333333333333';
const ZONA = 'America/Montevideo';
// 15:30 en Montevideo (UTC-3).
const A_LAS_1530 = new Date('2026-11-10T18:30:00.000Z');

const errores = async <T extends object>(
  clase: new () => T,
  datos: Record<string, unknown>,
) =>
  (await validate(plainToInstance(clase, datos))).flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap((c) => Object.values(c.constraints ?? {})),
  ]);

describe('retiro: horario, código y contacto (BL-210)', () => {
  it('horaLocal usa la zona del local', () => {
    expect(horaLocal(A_LAS_1530, ZONA)).toBe('15:30');
    expect(horaLocal(new Date('2026-11-10T03:05:00.000Z'), ZONA)).toBe('00:05');
  });

  it.each([
    ['15:30', '11:00', '16:00', true],
    ['16:00', '11:00', '16:00', false],
    ['11:00', '11:00', '16:00', true],
    ['10:59', '11:00', '16:00', false],
    // Cruza la medianoche.
    ['23:00', '19:00', '01:00', true],
    ['00:30', '19:00', '01:00', true],
    ['01:00', '19:00', '01:00', false],
    ['12:00', '19:00', '01:00', false],
  ])('dentroDeLaFranja(%s, %s, %s) = %s', (hora, desde, hasta, esperado) => {
    expect(dentroDeLaFranja(hora, desde, hasta)).toBe(esperado);
  });

  it('retiroAbierto: deshabilitado nunca; sin franja todo el día; con franja según la hora local', () => {
    const base = {
      retiroHabilitado: true,
      retiroHoraDesde: null,
      retiroHoraHasta: null,
    };
    expect(retiroAbierto(base, A_LAS_1530, ZONA)).toBe(true);
    expect(
      retiroAbierto({ ...base, retiroHabilitado: false }, A_LAS_1530, ZONA),
    ).toBe(false);
    const franja = {
      ...base,
      retiroHoraDesde: '11:00',
      retiroHoraHasta: '15:00',
    };
    expect(retiroAbierto(franja, A_LAS_1530, ZONA)).toBe(false);
    expect(
      retiroPublico({ ...franja, retiroHoraHasta: '16:00' }, A_LAS_1530, ZONA),
    ).toEqual({
      habilitado: true,
      abierto: true,
      horaDesde: '11:00',
      horaHasta: '16:00',
    });
    expect(mensajeRetiroNoDisponible(franja)).toBe(
      'Este local toma pedidos para retirar de 11:00 a 15:00.',
    );
    expect(
      mensajeRetiroNoDisponible({ ...base, retiroHabilitado: false }),
    ).toBe('Este local no está tomando pedidos para retirar.');
  });

  it('código: formato R-NNN y lo que escribe el colaborador se normaliza', () => {
    expect(formatearCodigoRetiro(7)).toBe('R-007');
    expect(formatearCodigoRetiro(999)).toBe('R-999');
    for (const texto of ['R-042', 'r42', ' R 042 ', '42', 'r-42']) {
      expect(normalizarCodigoRetiro(texto)).toBe('R-042');
    }
    for (const texto of ['', 'R-', 'X-042', '1000', '0', 'R-0420', 'abc']) {
      expect(normalizarCodigoRetiro(texto)).toBeNull();
    }
  });

  it('contacto: correo en minúsculas; teléfono solo con dígitos y el + inicial', () => {
    expect(normalizarContactoRetiro('  Ana@Correo.UY ')).toBe('ana@correo.uy');
    expect(normalizarContactoRetiro('099 123 456')).toBe('099123456');
    expect(normalizarContactoRetiro('+598 99-123-456')).toBe('+59899123456');
  });

  it('contactoRetiroParaGuardar: solo con consentimiento y un contacto que alcance', () => {
    const ahora = new Date('2026-11-10T18:00:00.000Z');
    const dto = {
      nombre: 'Ana',
      contacto: '099 123 456',
      consentimiento: true,
    };
    expect(contactoRetiroParaGuardar(dto, ahora)).toEqual({
      retiroNombre: 'Ana',
      retiroContacto: '099123456',
      retiroConsentidoEn: ahora,
    });
    const nada = {
      retiroNombre: null,
      retiroContacto: null,
      retiroConsentidoEn: null,
    };
    expect(contactoRetiroParaGuardar(undefined, ahora)).toEqual(nada);
    expect(
      contactoRetiroParaGuardar({ ...dto, consentimiento: false }, ahora),
    ).toEqual(nada);
    expect(
      contactoRetiroParaGuardar({ ...dto, contacto: '+ ab' }, ahora),
    ).toEqual(nada);
  });

  it('ContactoRetiroDto: nombre y contacto con largo, y consentimiento booleano', async () => {
    expect(
      await errores(ContactoRetiroDto, {
        nombre: '  Ana   María ',
        contacto: '099123456',
        consentimiento: true,
      }),
    ).toEqual([]);
    expect(
      await errores(ContactoRetiroDto, {
        nombre: '',
        contacto: '09',
        consentimiento: 'si',
      }),
    ).toEqual([
      'El nombre debe tener entre 1 y 60 caracteres',
      'El contacto debe tener entre 3 y 100 caracteres',
      'consentimiento debe ser verdadero o falso',
    ]);
    const dto = plainToInstance(ContactoRetiroDto, {
      nombre: '  Ana   María ',
      contacto: ' 099 ',
      consentimiento: true,
    });
    expect(dto.nombre).toBe('Ana María');
  });

  it('CrearPedidoDto valida el contacto del retiro anidado', async () => {
    const base = {
      restauranteId: RESTAURANTE_ID,
      idempotencyKey: 'k-1',
      items: [{ itemCartaId: PEDIDO_ID, cantidad: 1 }],
    };
    expect(await errores(CrearPedidoDto, base)).toEqual([]);
    expect(
      await errores(CrearPedidoDto, {
        ...base,
        contactoRetiro: { nombre: 'Ana', contacto: 'x', consentimiento: true },
      }),
    ).toEqual(['El contacto debe tener entre 3 y 100 caracteres']);
  });
});

describe('PedidosService: pedido para retirar (BL-210)', () => {
  let tx: any;
  let service: PedidosService;
  const restaurante = (extra: Record<string, unknown> = {}) => ({
    tenantId: TENANT_ID,
    timezone: ZONA,
    retiroHabilitado: true,
    retiroHoraDesde: null,
    retiroHoraHasta: null,
    ...extra,
  });
  const dto = (extra: Record<string, unknown> = {}) =>
    ({
      restauranteId: RESTAURANTE_ID,
      idempotencyKey: 'k-retiro',
      items: [{ itemCartaId: 'item-1', cantidad: 1 }],
      ...extra,
    }) as any;

  beforeEach(() => {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'p-1', lineas: [], ...data }),
          ),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      mesa: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'mesa-virtual', numero: 0 }),
      },
      restaurante: { findUnique: jest.fn().mockResolvedValue(restaurante()) },
      itemCarta: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'item-1',
            nombre: 'Pizza',
            precio: new Decimal('350'),
            disponible: true,
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ numero: 42 }]),
    };
    service = new PedidosService(
      {
        runInTenantContext: jest.fn((_t: string, fn: (t: unknown) => unknown) =>
          fn(tx),
        ),
      } as any,
      { emitirNuevoPedido: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  it('guarda el nombre y el contacto con consentimiento', async () => {
    await service.crear(
      TENANT_ID,
      dto({
        contactoRetiro: {
          nombre: 'Ana',
          contacto: '099 123 456',
          consentimiento: true,
        },
      }),
    );
    expect(tx.pedido.create.mock.calls[0][0].data).toMatchObject({
      canal: 'WEB',
      retiroNombre: 'Ana',
      retiroContacto: '099123456',
      retiroConsentidoEn: expect.any(Date),
    });
  });

  it('sin consentimiento no guarda nada del comensal', async () => {
    await service.crear(
      TENANT_ID,
      dto({
        contactoRetiro: {
          nombre: 'Ana',
          contacto: '099123456',
          consentimiento: false,
        },
      }),
    );
    expect(tx.pedido.create.mock.calls[0][0].data).toMatchObject({
      retiroNombre: null,
      retiroContacto: null,
      retiroConsentidoEn: null,
    });
  });

  it.each([
    ['deshabilitado', { retiroHabilitado: false }],
    [
      'fuera de la franja',
      { retiroHoraDesde: '00:00', retiroHoraHasta: '00:01' },
    ],
  ])(
    'retiro %s: 409 RETIRO_NO_DISPONIBLE sin crear el pedido',
    async (_caso, extra) => {
      tx.restaurante.findUnique.mockResolvedValue(restaurante(extra));
      const intento = service.crear(TENANT_ID, dto());
      await expect(intento).rejects.toBeInstanceOf(ConflictException);
      await expect(intento).rejects.toMatchObject({
        response: { codigo: CODIGO_RETIRO_NO_DISPONIBLE },
      });
      expect(tx.pedido.create).not.toHaveBeenCalled();
    },
  );

  it('un pedido de mesa con contacto de retiro: 400', async () => {
    tx.mesa.findUnique.mockResolvedValue({
      id: 'mesa-3',
      numero: 3,
      tenantId: TENANT_ID,
      restauranteId: RESTAURANTE_ID,
      esVirtual: false,
    });
    await expect(
      service.crear(
        TENANT_ID,
        dto({
          restauranteId: undefined,
          contactoRetiro: {
            nombre: 'Ana',
            contacto: '099123456',
            consentimiento: true,
          },
        }),
        { mesaId: 'mesa-3' } as any,
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'contactoRetiro solo va en un pedido para retirar',
      ),
    );
  });

  describe('código al aprobarse el pago', () => {
    beforeEach(() => {
      tx.pedido.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      tx.pedidoEstadoHistorial = { create: jest.fn() };
      tx.restaurante.findUnique.mockResolvedValue({
        limitePedidosEnPreparacion: null,
      });
      (service as any).descuentoStock = {
        descontarEnTx: jest.fn().mockResolvedValue([]),
      };
    });

    it('pedido para retirar sin código: toma el próximo del contador', async () => {
      tx.pedido.findUniqueOrThrow
        .mockResolvedValueOnce({
          codigoRetiro: null,
          mesa: { esVirtual: true },
        })
        .mockResolvedValue({ id: PEDIDO_ID, mesa: { numero: 0 }, lineas: [] });

      await service.confirmarPagoEnTx(tx, TENANT_ID, PEDIDO_ID);

      const sql = tx.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain('UPDATE restaurante');
      expect(sql).toContain('ultimo_codigo_retiro');
      expect(tx.pedido.update).toHaveBeenCalledWith({
        where: { id: PEDIDO_ID },
        data: { codigoRetiro: 'R-042' },
      });
    });

    it.each([
      ['de mesa', { codigoRetiro: null, mesa: { esVirtual: false } }],
      [
        'que ya tiene código',
        { codigoRetiro: 'R-007', mesa: { esVirtual: true } },
      ],
    ])('pedido %s: no toca el contador', async (_caso, leido) => {
      tx.pedido.findUniqueOrThrow
        .mockResolvedValueOnce(leido)
        .mockResolvedValue({ id: PEDIDO_ID, mesa: { numero: 3 }, lineas: [] });

      await service.confirmarPagoEnTx(tx, TENANT_ID, PEDIDO_ID);

      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.pedido.update).not.toHaveBeenCalled();
    });
  });
});

describe('PedidosTransicionService: entrega del retiro (BL-210)', () => {
  let tx: any;
  let service: PedidosTransicionService;
  const entregar = (codigo = 'r42') =>
    service.entregarRetiro({
      tenantId: TENANT_ID,
      keycloakId: 'kc-mozo',
      pedidoId: PEDIDO_ID,
      codigo,
    });

  beforeEach(() => {
    tx = {
      pedido: {
        findUnique: jest.fn().mockResolvedValue({
          estado: 'LISTO_PARA_ENTREGAR',
          codigoRetiro: 'R-042',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: PEDIDO_ID,
          estado: 'ENTREGADO',
          updatedAt: new Date('2026-11-10T18:40:00.000Z'),
          mesa: { numero: 0 },
          lineas: [],
        }),
        update: jest.fn(),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue({ id: 'u-mozo' }) },
      pedidoEstadoHistorial: { create: jest.fn() },
    };
    service = new PedidosTransicionService({
      runInTenantContext: jest.fn((_t: string, fn: (t: unknown) => unknown) =>
        fn(tx),
      ),
    } as any);
  });

  it('con el código correcto: ENTREGADO con historial', async () => {
    await expect(entregar()).resolves.toEqual({
      id: PEDIDO_ID,
      estado: 'ENTREGADO',
      actualizadoEn: '2026-11-10T18:40:00.000Z',
      mesaNumero: 0,
      lineas: [],
    });
    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: { id: PEDIDO_ID, estado: 'LISTO_PARA_ENTREGAR' },
      data: { estado: 'ENTREGADO' },
    });
    expect(tx.pedidoEstadoHistorial.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        pedidoId: PEDIDO_ID,
        usuarioId: 'u-mozo',
        estadoAnterior: 'LISTO_PARA_ENTREGAR',
        estadoNuevo: 'ENTREGADO',
      },
    });
  });

  it('un código que no tiene la forma: 400 sin consultar', async () => {
    await expect(entregar('hola')).rejects.toThrow(
      new BadRequestException('El código de retiro tiene la forma R-042'),
    );
    expect(tx.pedido.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['no existe', null, NotFoundException, 'Pedido no encontrado'],
    [
      'no es para retirar',
      { estado: 'LISTO_PARA_ENTREGAR', codigoRetiro: null },
      ConflictException,
      'Este pedido no es para retirar',
    ],
    [
      'todavía no está listo',
      { estado: 'EN_PREPARACION', codigoRetiro: 'R-042' },
      ConflictException,
      'El pedido todavía no está listo para retirar',
    ],
    [
      'ya se entregó',
      { estado: 'ENTREGADO', codigoRetiro: 'R-042' },
      ConflictException,
      'Este pedido ya se entregó',
    ],
    [
      'el código no coincide',
      { estado: 'LISTO_PARA_ENTREGAR', codigoRetiro: 'R-043' },
      ConflictException,
      'El código no coincide: este pedido es el R-043',
    ],
  ])('%s: no entrega', async (_caso, leido, tipo, mensaje) => {
    tx.pedido.findUnique.mockResolvedValue(leido);
    const intento = entregar();
    await expect(intento).rejects.toBeInstanceOf(tipo);
    await expect(intento).rejects.toThrow(mensaje);
    expect(tx.pedido.updateMany).not.toHaveBeenCalled();
  });

  it('sin fila de usuario: 404; si otro lo entregó entre medio: 409', async () => {
    tx.usuario.findUnique.mockResolvedValueOnce(null);
    await expect(entregar()).rejects.toBeInstanceOf(NotFoundException);

    tx.pedido.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(entregar()).rejects.toThrow('Este pedido ya se entregó');
    expect(tx.pedidoEstadoHistorial.create).not.toHaveBeenCalled();
  });

  it('el botón común del KDS no entrega un pedido para retirar', async () => {
    tx.pedido.findUnique.mockResolvedValue({
      id: PEDIDO_ID,
      estado: 'LISTO_PARA_ENTREGAR',
      codigoRetiro: 'R-042',
    });
    await expect(
      service.transicionar({
        tenantId: TENANT_ID,
        keycloakId: 'kc-mozo',
        pedidoId: PEDIDO_ID,
        nuevoEstado: 'ENTREGADO',
      }),
    ).rejects.toThrow(new BadRequestException(MENSAJE_ENTREGA_CON_CODIGO));
    expect(tx.pedido.update).not.toHaveBeenCalled();
  });
});

describe('PedidosController.entregarRetiro (BL-210)', () => {
  it('entrega con el tenant y el actor del token y avisa al KDS y al comensal', async () => {
    const entregado = { id: PEDIDO_ID, estado: 'ENTREGADO' };
    const transicion = {
      entregarRetiro: jest.fn().mockResolvedValue(entregado),
    };
    const kds = { emitirPedidoActualizado: jest.fn() };
    const controller = new PedidosController(
      {} as any,
      transicion as any,
      kds as any,
    );

    await expect(
      controller.entregarRetiro(
        {
          user: { tenantId: TENANT_ID, sub: 'kc-mozo', roles: ['MOZO'] },
        } as any,
        PEDIDO_ID,
        { codigo: 'R-042' },
      ),
    ).resolves.toBe(entregado);
    expect(transicion.entregarRetiro).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      keycloakId: 'kc-mozo',
      pedidoId: PEDIDO_ID,
      codigo: 'R-042',
    });
    expect(kds.emitirPedidoActualizado).toHaveBeenCalledWith(
      TENANT_ID,
      entregado,
    );
  });

  it('EntregarRetiroDto: texto de 1 a 10 caracteres', async () => {
    expect(await errores(EntregarRetiroDto, { codigo: 'R-042' })).toEqual([]);
    expect(await errores(EntregarRetiroDto, { codigo: '' })).toEqual([
      'El código de retiro debe tener entre 1 y 10 caracteres',
    ]);
  });
});

describe('configuración del retiro (BL-210)', () => {
  it('DTO: horas HH:MM; vacío o null quita la franja', async () => {
    expect(
      await errores(ActualizarConfiguracionDto, {
        retiroHabilitado: false,
        retiroHoraDesde: '11:00',
        retiroHoraHasta: '23:59',
      }),
    ).toEqual([]);
    expect(
      await errores(ActualizarConfiguracionDto, {
        retiroHoraDesde: '24:00',
        retiroHoraHasta: '9:00',
        retiroHabilitado: 'si',
      }),
    ).toEqual([
      'retiroHabilitado debe ser verdadero o falso',
      'La hora de inicio del retiro tiene que tener la forma HH:MM',
      'La hora de cierre del retiro tiene que tener la forma HH:MM',
    ]);
    const dto = plainToInstance(ActualizarConfiguracionDto, {
      retiroHoraDesde: '  ',
      retiroHoraHasta: null,
    });
    expect(dto.retiroHoraDesde).toBeNull();
    expect(await validate(dto)).toEqual([]);
  });

  describe('servicio: las dos horas o ninguna, y distintas', () => {
    let tx: any;
    let service: ConfiguracionEstablecimientoService;
    const guardado = (extra: Record<string, unknown> = {}) => ({
      efectivoHabilitado: true,
      retiroHabilitado: true,
      retiroHoraDesde: null,
      retiroHoraHasta: null,
      ...extra,
    });

    beforeEach(() => {
      tx = {
        tenant: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ razonSocial: 'X', rut: '219999990016' }),
        },
        restaurante: {
          findUnique: jest.fn().mockResolvedValue(guardado()),
          update: jest
            .fn()
            .mockImplementation(({ data }) => Promise.resolve(guardado(data))),
        },
      };
      service = new ConfiguracionEstablecimientoService(
        {
          runInTenantContext: jest.fn(
            (_t: string, fn: (t: unknown) => unknown) => fn(tx),
          ),
        } as any,
        { registrarEnTx: jest.fn() } as any,
        { avisarEstadoCola: jest.fn() } as any,
      );
    });

    it('guarda la franja completa y la audita', async () => {
      const r = await service.actualizar(
        TENANT_ID,
        { retiroHoraDesde: '11:00', retiroHoraHasta: '15:00' },
        { id: 'kc-admin' },
      );
      expect(r).toMatchObject({
        retiroHoraDesde: '11:00',
        retiroHoraHasta: '15:00',
      });
    });

    it('una sola hora: 400; con la otra guardada, alcanza', async () => {
      await expect(
        service.actualizar(
          TENANT_ID,
          { retiroHoraDesde: '11:00' },
          { id: 'kc-admin' },
        ),
      ).rejects.toThrow(
        'Completá las dos horas del retiro, o dejá las dos vacías para tomar pedidos todo el día',
      );
      tx.restaurante.findUnique.mockResolvedValue(
        guardado({ retiroHoraDesde: '10:00', retiroHoraHasta: '15:00' }),
      );
      await expect(
        service.actualizar(
          TENANT_ID,
          { retiroHoraDesde: '11:00' },
          { id: 'kc-admin' },
        ),
      ).resolves.toMatchObject({ retiroHoraDesde: '11:00' });
      await expect(
        service.actualizar(
          TENANT_ID,
          { retiroHoraDesde: '15:00' },
          { id: 'kc-admin' },
        ),
      ).rejects.toThrow(
        'La hora de inicio y la de cierre del retiro tienen que ser distintas',
      );
    });
  });
});

describe('AnonimizarRetiroService (BL-210)', () => {
  it('borra el nombre y el contacto de los pedidos con ese contacto y lo audita sin el contacto', async () => {
    const tx = {
      pedido: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const auditLog = { registrarEnTx: jest.fn() };
    const service = new AnonimizarRetiroService(
      {
        runInTenantContext: jest.fn((_t: string, fn: (t: unknown) => unknown) =>
          fn(tx),
        ),
      } as any,
      auditLog as any,
    );
    const ahora = new Date('2026-11-10T18:00:00.000Z');

    await expect(
      service.anonimizar(TENANT_ID, '099123456', { id: 'kc-admin' }, ahora),
    ).resolves.toEqual({ pedidos: 3 });

    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, retiroContacto: '099123456' },
      data: {
        retiroNombre: null,
        retiroContacto: null,
        retiroAnonimizadoEn: ahora,
      },
    });
    expect(auditLog.registrarEnTx).toHaveBeenCalledWith(tx, {
      action: AuditAction.PEDIDO_RETIRO_ANONIMIZADO,
      tenantId: TENANT_ID,
      actorKeycloakId: 'kc-admin',
      detalle: { pedidos: 3 },
    });
  });

  it('el DTO normaliza el contacto igual que al guardarlo', async () => {
    const dto = plainToInstance(AnonimizarRetiroDto, {
      contacto: ' 099 123 456 ',
    });
    expect(dto.contacto).toBe('099123456');
    expect(await validate(dto)).toEqual([]);
    expect(await errores(AnonimizarRetiroDto, { contacto: '1' })).toEqual([
      'El contacto debe tener entre 3 y 100 caracteres',
    ]);
  });
});
