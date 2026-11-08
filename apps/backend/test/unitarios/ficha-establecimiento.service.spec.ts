import { NotFoundException } from '@nestjs/common';
import {
  cuentaParaFicha,
  DIAS_RESUMEN_PEDIDOS,
  FichaEstablecimientoService,
} from '../../src/plataforma/ficha-establecimiento.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';
import { UsuariosService } from '../../src/usuarios/usuarios.service';

/**
 * BL-411: ficha de un establecimiento para el rol PLATAFORMA. Los datos de
 * la base se leen en el contexto del tenant (RLS); las cuentas, con
 * UsuariosService.listar.
 */

const TENANT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const CREADO = new Date('2026-10-09T12:00:00Z');
const COMPLETADA = new Date('2026-10-09T12:05:00Z');
const AHORA = new Date('2026-10-22T12:00:00Z');

const TENANT = {
  razonSocial: 'Uno SRL',
  rut: '219999990016',
  plan: 'BASICO',
  creadoPor: 'dev-daiana-plataforma',
  createdAt: CREADO,
  estado: 'ACTIVO',
  suspendidoEn: null,
  motivoSuspension: null,
  altaCompletadaEn: COMPLETADA,
};

const RESTAURANTE = {
  id: 'r-1',
  nombre: 'Restaurante Uno',
  direccion: 'Calle 123',
  timezone: 'America/Montevideo',
};

const CUENTAS = [
  {
    id: 'u-mozo',
    rol: 'MOZO',
    cuentaCompartida: false,
    username: 'uno-mozo',
    nombre: 'Mozo',
    apellido: 'Uno',
    activo: true,
    email: 'mozo@uno.local',
    keycloakId: 'kc-mozo',
    ultimoIngreso: null,
  },
  {
    id: 'u-admin-b',
    rol: 'ADMIN',
    cuentaCompartida: false,
    username: 'uno-admin-b',
    nombre: 'Beatriz',
    apellido: 'Pérez',
    activo: false,
    email: 'b@uno.local',
    keycloakId: 'kc-admin-b',
    ultimoIngreso: null,
  },
  {
    id: 'u-admin-a',
    rol: 'ADMIN',
    cuentaCompartida: false,
    username: 'uno-admin-a',
    nombre: 'Ana',
    apellido: 'Gómez',
    activo: true,
    email: 'a@uno.local',
    keycloakId: 'kc-admin-a',
    ultimoIngreso: '2026-10-21T10:00:00.000Z',
  },
  {
    id: 'kc-cocina',
    rol: 'COCINA',
    cuentaCompartida: true,
    username: 'uno-cocina',
    nombre: 'Cocina',
    apellido: 'BistroLink',
    activo: true,
    email: 'uno-cocina@tecnico.bistrolink.local',
    keycloakId: 'kc-cocina',
    ultimoIngreso: '2026-10-22T09:00:00.000Z',
  },
];

describe('FichaEstablecimientoService (BL-411)', () => {
  let contextos: string[];
  let tx: any;
  let usuarios: { listar: jest.Mock };
  let service: FichaEstablecimientoService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: { findUnique: jest.fn().mockResolvedValue(TENANT) },
      restaurante: { findUnique: jest.fn().mockResolvedValue(RESTAURANTE) },
      mesa: { count: jest.fn().mockResolvedValue(8) },
      itemCarta: { count: jest.fn().mockResolvedValue(24) },
      pedido: {
        count: jest.fn().mockResolvedValue(57),
        // BL-418: tiene pedidos, no se puede eliminar.
        findFirst: jest.fn().mockResolvedValue({ id: 'pedido-1' }),
      },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    usuarios = { listar: jest.fn().mockResolvedValue(CUENTAS) };
    service = new FichaEstablecimientoService(
      tenantPrisma as unknown as TenantPrismaService,
      usuarios as unknown as UsuariosService,
    );
  });

  it('lee todo dentro del contexto de ESE tenant (RLS)', async () => {
    await service.obtener(TENANT_ID, AHORA);

    expect(contextos).toEqual([TENANT_ID]);
    expect(tx.restaurante.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID } }),
    );
    expect(usuarios.listar).toHaveBeenCalledWith(TENANT_ID);
  });

  it('devuelve los datos del establecimiento, su estado y su restaurante', async () => {
    const ficha = await service.obtener(TENANT_ID, AHORA);

    expect(ficha).toEqual(
      expect.objectContaining({
        tenantId: TENANT_ID,
        razonSocial: 'Uno SRL',
        rut: '219999990016',
        plan: 'BASICO',
        creadoPor: 'dev-daiana-plataforma',
        creadoEl: CREADO,
        estado: 'ACTIVO',
        altaCompletadaEn: COMPLETADA,
        suspension: null,
        restaurante: RESTAURANTE,
      }),
    );
  });

  it('resumen: mesas sin la virtual, ítems de la carta y pedidos de los últimos 30 días', async () => {
    const ficha = await service.obtener(TENANT_ID, AHORA);

    expect(ficha.resumen).toEqual({
      mesas: 8,
      itemsCarta: 24,
      pedidosRecientes: 57,
      diasPedidos: DIAS_RESUMEN_PEDIDOS,
      // BL-413: el mock de count devuelve lo mismo para los dos conteos.
      pedidosAbiertos: 57,
    });
    expect(tx.mesa.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, esVirtual: false },
    });
    expect(tx.itemCarta.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
    expect(tx.pedido.count).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        createdAt: { gte: new Date('2026-09-22T12:00:00Z') },
      },
    });
    // BL-413: pedidos sin terminar, para el aviso al suspender.
    expect(tx.pedido.count).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        estado: { in: ['RECIBIDO', 'EN_PREPARACION', 'LISTO_PARA_ENTREGAR'] },
      },
    });
  });

  it('[TC-U-156] Administradores ordenados por usuario, con el id de su fila (BL-414), sin Mozos ni datos de más', async () => {
    const ficha = await service.obtener(TENANT_ID, AHORA);

    expect(ficha.administradores).toEqual([
      {
        id: 'u-admin-a',
        username: 'uno-admin-a',
        nombre: 'Ana',
        apellido: 'Gómez',
        activo: true,
        ultimoIngreso: '2026-10-21T10:00:00.000Z',
      },
      {
        id: 'u-admin-b',
        username: 'uno-admin-b',
        nombre: 'Beatriz',
        apellido: 'Pérez',
        activo: false,
        ultimoIngreso: null,
      },
    ]);
  });

  it('la cuenta de Cocina, sin email ni id', async () => {
    const ficha = await service.obtener(TENANT_ID, AHORA);

    expect(ficha.cocina).toEqual([
      {
        username: 'uno-cocina',
        nombre: 'Cocina',
        apellido: 'BistroLink',
        activo: true,
        ultimoIngreso: '2026-10-22T09:00:00.000Z',
      },
    ]);
  });

  it('no devuelve contraseñas, emails ni ids de Keycloak', async () => {
    const texto = JSON.stringify(await service.obtener(TENANT_ID, AHORA));

    expect(texto).not.toMatch(/password|contrasena/i);
    expect(texto).not.toContain('@');
    expect(texto).not.toContain('kc-');
  });

  it('suspendido: trae la fecha y el motivo', async () => {
    const desde = new Date('2026-10-20T15:00:00Z');
    tx.tenant.findUnique.mockResolvedValue({
      ...TENANT,
      estado: 'SUSPENDIDO',
      suspendidoEn: desde,
      motivoSuspension: 'Falta de pago',
    });

    const ficha = await service.obtener(TENANT_ID, AHORA);

    expect(ficha.estado).toBe('SUSPENDIDO');
    expect(ficha.suspension).toEqual({ desde, motivo: 'Falta de pago' });
  });

  it('alta incompleta sin restaurante: sin resumen y sin consultar los conteos', async () => {
    tx.tenant.findUnique.mockResolvedValue({
      ...TENANT,
      altaCompletadaEn: null,
    });
    tx.restaurante.findUnique.mockResolvedValue(null);

    const ficha = await service.obtener(TENANT_ID, AHORA);

    expect(ficha.estado).toBe('ALTA_INCOMPLETA');
    expect(ficha.restaurante).toBeNull();
    expect(ficha.resumen).toBeNull();
    expect(tx.mesa.count).not.toHaveBeenCalled();
    expect(tx.pedido.count).not.toHaveBeenCalled();
  });

  it('[TC-U-174] BL-418: eliminable solo si no tiene ningún pedido, de cualquier estado', async () => {
    expect((await service.obtener(TENANT_ID, AHORA)).eliminable).toBe(false);
    expect(tx.pedido.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      select: { id: true },
    });

    tx.pedido.findFirst.mockResolvedValue(null);
    expect((await service.obtener(TENANT_ID, AHORA)).eliminable).toBe(true);
  });

  it('un tenant inexistente da 404, sin buscar cuentas', async () => {
    tx.tenant.findUnique.mockResolvedValue(null);

    await expect(service.obtener(TENANT_ID, AHORA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(usuarios.listar).not.toHaveBeenCalled();
  });
});

describe('cuentaParaFicha (BL-411)', () => {
  const base = {
    rol: 'ADMIN',
    cuentaCompartida: false,
    username: 'uno-admin',
    nombre: 'Ana',
    apellido: 'Gómez',
    activo: true,
  };

  it('sin último ingreso (Keycloak no respondió), no agrega el campo', () => {
    expect(cuentaParaFicha(base)).not.toHaveProperty('ultimoIngreso');
  });

  it('con último ingreso null (sin ingresos recientes), lo conserva', () => {
    expect(cuentaParaFicha({ ...base, ultimoIngreso: null })).toHaveProperty(
      'ultimoIngreso',
      null,
    );
  });
});
