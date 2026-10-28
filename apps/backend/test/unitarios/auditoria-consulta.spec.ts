import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RolesGuard } from '../../src/auth/roles.guard';
import {
  AuditoriaConsultaService,
  TAMANO_PAGINA_AUDITORIA,
} from '../../src/audit-log/auditoria-consulta.service';
import { AuditoriaController } from '../../src/audit-log/auditoria.controller';
import { ConsultarAuditoriaDto } from '../../src/audit-log/dto/consultar-auditoria.dto';
import {
  ContextoAuditoriaMiddleware,
  contextoAuditoria,
  ipDeLaRequest,
} from '../../src/audit-log/contexto-auditoria';

// HU-035 (BL-205): consulta del registro de auditoría y contexto de la IP.

const TENANT = '11111111-1111-1111-1111-111111111111';

function fila(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `r-${n}`,
    createdAt: new Date(Date.UTC(2026, 9, 27, 12, 0, n)),
    accion: 'CARTA_ITEM_MODIFICADO',
    entidad: 'item_carta',
    entidadId: 'item-1',
    usuarioId: 'u-1',
    actorKeycloakId: 'kc-1',
    valoresAntes: { precio: '12.50' },
    valoresDespues: { precio: '14.00' },
    detalle: null,
    ip: '203.0.113.7',
    ...overrides,
  };
}

describe('AuditoriaConsultaService', () => {
  let tx: {
    registroAuditoria: { findMany: jest.Mock };
    usuario: { findMany: jest.Mock };
  };
  let tenantPrisma: { runInTenantContext: jest.Mock };
  let service: AuditoriaConsultaService;

  beforeEach(() => {
    tx = {
      registroAuditoria: { findMany: jest.fn().mockResolvedValue([fila(1)]) },
      usuario: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'u-1',
            nombre: 'Ana',
            apellido: 'Pérez',
            username: 'ana',
            email: null,
          },
        ]),
      },
    };
    tenantPrisma = {
      runInTenantContext: jest.fn((_t: string, fn: (t: unknown) => unknown) =>
        fn(tx),
      ),
    };
    service = new AuditoriaConsultaService(tenantPrisma as any);
  });

  it('consulta siempre dentro del tenant del token, lo más reciente primero', async () => {
    const r = await service.consultar(TENANT, {});

    expect(tenantPrisma.runInTenantContext).toHaveBeenCalledWith(
      TENANT,
      expect.any(Function),
    );
    expect(tx.registroAuditoria.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: TAMANO_PAGINA_AUDITORIA + 1,
    });
    expect(r).toEqual({
      pagina: 1,
      hayMas: false,
      registros: [
        {
          id: 'r-1',
          fecha: '2026-10-27T12:00:01.000Z',
          accion: 'CARTA_ITEM_MODIFICADO',
          entidad: 'item_carta',
          entidadId: 'item-1',
          usuario: { id: 'u-1', nombre: 'Ana Pérez' },
          actorKeycloakId: 'kc-1',
          valoresAntes: { precio: '12.50' },
          valoresDespues: { precio: '14.00' },
          detalle: null,
          ip: '203.0.113.7',
        },
      ],
    });
  });

  it('filtra por fecha, usuario y acción, y pagina', async () => {
    await service.consultar(TENANT, {
      desde: '2026-10-01T00:00:00.000Z',
      hasta: '2026-10-31T23:59:59.999Z',
      usuarioId: 'u-1',
      accion: 'CARTA_ITEM_MODIFICADO' as never,
      pagina: 3,
    });

    expect(tx.registroAuditoria.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          createdAt: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-31T23:59:59.999Z'),
          },
          usuarioId: 'u-1',
          accion: 'CARTA_ITEM_MODIFICADO',
        },
        skip: 2 * TAMANO_PAGINA_AUDITORIA,
      }),
    );
  });

  it('solo «desde» o solo «hasta» también filtran', async () => {
    await service.consultar(TENANT, { desde: '2026-10-01T00:00:00.000Z' });
    await service.consultar(TENANT, { hasta: '2026-10-01T00:00:00.000Z' });

    expect(tx.registroAuditoria.findMany.mock.calls[0][0].where).toEqual({
      createdAt: { gte: new Date('2026-10-01T00:00:00.000Z') },
    });
    expect(tx.registroAuditoria.findMany.mock.calls[1][0].where).toEqual({
      createdAt: { lte: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('«desde» posterior a «hasta» responde 400', async () => {
    await expect(
      service.consultar(TENANT, {
        desde: '2026-10-31T00:00:00.000Z',
        hasta: '2026-10-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('indica si hay otra página sin devolver el registro de más', async () => {
    tx.registroAuditoria.findMany.mockResolvedValue(
      Array.from({ length: TAMANO_PAGINA_AUDITORIA + 1 }, (_, i) => fila(i)),
    );

    const r = await service.consultar(TENANT, {});

    expect(r.hayMas).toBe(true);
    expect(r.registros).toHaveLength(TAMANO_PAGINA_AUDITORIA);
  });

  it('acciones de la plataforma o de un script: sin usuario; sin nombre, el usuario o el email', async () => {
    tx.registroAuditoria.findMany.mockResolvedValue([
      fila(1, { usuarioId: null }),
      fila(2, { usuarioId: 'u-2' }),
      fila(3, { usuarioId: 'u-3' }),
      fila(4, { usuarioId: 'u-4' }),
    ]);
    tx.usuario.findMany.mockResolvedValue([
      {
        id: 'u-2',
        nombre: null,
        apellido: null,
        username: 'mozo1',
        email: null,
      },
      {
        id: 'u-3',
        nombre: null,
        apellido: null,
        username: null,
        email: 'a@b.uy',
      },
      { id: 'u-4', nombre: null, apellido: null, username: null, email: null },
    ]);

    const r = await service.consultar(TENANT, {});

    expect(r.registros.map((x) => x.usuario?.nombre ?? null)).toEqual([
      null,
      'mozo1',
      'a@b.uy',
      'Usuario sin nombre',
    ]);
  });

  it('sin registros no consulta usuarios', async () => {
    tx.registroAuditoria.findMany.mockResolvedValue([]);

    const r = await service.consultar(TENANT, {});

    expect(tx.usuario.findMany).not.toHaveBeenCalled();
    expect(r.registros).toEqual([]);
  });
});

describe('ConsultarAuditoriaDto', () => {
  const validar = (datos: Record<string, unknown>) =>
    validate(plainToInstance(ConsultarAuditoriaDto, datos));

  it('acepta filtros válidos (la página llega como texto en la query)', async () => {
    expect(
      await validar({
        desde: '2026-10-01T00:00:00.000Z',
        usuarioId: '11111111-1111-4111-8111-111111111111',
        accion: 'USUARIO_CREADO',
        pagina: '2',
      }),
    ).toHaveLength(0);
  });

  it('rechaza una acción que no existe, una fecha inválida o la página 0', async () => {
    const errores = await validar({
      accion: 'BORRAR_TODO',
      desde: 'ayer',
      pagina: '0',
    });
    expect(errores.map((e) => e.property).sort()).toEqual([
      'accion',
      'desde',
      'pagina',
    ]);
  });
});

describe('AuditoriaController', () => {
  it('pasa el tenant del token y los filtros al servicio', async () => {
    const consulta = { consultar: jest.fn().mockResolvedValue('ok') };
    const controller = new AuditoriaController(consulta as any);

    await controller.consultar({ user: { tenantId: TENANT } } as any, {
      pagina: 2,
    });

    expect(consulta.consultar).toHaveBeenCalledWith(TENANT, { pagina: 2 });
  });

  it.each([['MOZO'], ['COCINA'], ['COMENSAL'], ['PLATAFORMA']])(
    'solo el ADMIN la consulta: %s recibe 403',
    (rol) => {
      const guard = new RolesGuard(new Reflector());
      const contexto = (roles: string[]) =>
        ({
          getHandler: () => AuditoriaController.prototype.consultar,
          getClass: () => AuditoriaController,
          switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
        }) as unknown as ExecutionContext;

      expect(guard.canActivate(contexto(['ADMIN']))).toBe(true);
      expect(() => guard.canActivate(contexto([rol]))).toThrow(
        ForbiddenException,
      );
    },
  );
});

describe('contexto de auditoría (IP)', () => {
  it('toma la ÚLTIMA IP de X-Forwarded-For (la que agrega el proxy)', () => {
    expect(
      ipDeLaRequest({
        headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' },
        socket: { remoteAddress: '10.0.0.1' },
      }),
    ).toBe('203.0.113.7');
    expect(
      ipDeLaRequest({ headers: { 'x-forwarded-for': ['1.1.1.1', '9.9.9.9'] } }),
    ).toBe('9.9.9.9');
  });

  it('sin proxy usa la del socket; sin nada, null', () => {
    expect(
      ipDeLaRequest({ headers: {}, socket: { remoteAddress: '::1' } }),
    ).toBe('::1');
    expect(ipDeLaRequest({ headers: { 'x-forwarded-for': ' , ' } })).toBeNull();
  });

  it('recorta a 45 caracteres (largo de la columna)', () => {
    expect(
      ipDeLaRequest({ headers: { 'x-forwarded-for': 'x'.repeat(60) } }),
    ).toHaveLength(45);
  });

  it('el middleware deja la IP disponible durante la request', () => {
    let vista: string | null | undefined;
    new ContextoAuditoriaMiddleware().use(
      { headers: { 'x-forwarded-for': '203.0.113.7' } },
      {},
      () => {
        vista = contextoAuditoria()?.ip;
      },
    );

    expect(vista).toBe('203.0.113.7');
    expect(contextoAuditoria()).toBeUndefined();
  });
});
