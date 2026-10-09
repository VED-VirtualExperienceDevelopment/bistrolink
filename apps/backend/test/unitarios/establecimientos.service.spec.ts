import { EstablecimientosService } from '../../src/plataforma/establecimientos.service';
import { TenantPrismaService } from '../../src/prisma/tenant-prisma.service';

/**
 * BL-163 (HU-027): listado de establecimientos para el rol PLATAFORMA.
 * La lista de tenants sale de una consulta (tenant no tiene RLS); el
 * restaurante de cada uno se lee en el contexto de SU tenant (restaurante
 * tiene RLS forzado).
 */

const T1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const T2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const CREADO = new Date('2026-10-09T12:00:00Z');

describe('EstablecimientosService (BL-163)', () => {
  let contextos: string[];
  let tx: any;
  let service: EstablecimientosService;

  beforeEach(() => {
    contextos = [];
    tx = {
      tenant: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            id: T1,
            razonSocial: 'Uno SRL',
            rut: '210000000001',
            plan: 'BASICO',
            creadoPor: 'dev-daiana-plataforma',
            createdAt: CREADO,
          },
          {
            id: T2,
            razonSocial: 'Dos SRL',
            rut: '210000000002',
            plan: 'BASICO',
            creadoPor: null,
            createdAt: CREADO,
          },
        ]),
      },
      restaurante: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.tenantId === T1
              ? { id: 'r-1', nombre: 'Restaurante Uno' }
              : null,
          ),
        ),
      },
    };
    const tenantPrisma = {
      runInTenantContext: jest.fn((tenantId: string, fn: any) => {
        contextos.push(tenantId);
        return fn(tx);
      }),
    };
    service = new EstablecimientosService(
      tenantPrisma as unknown as TenantPrismaService,
    );
  });

  it('pagina de a 20, del alta más reciente a la más vieja', async () => {
    await service.listar(3);

    expect(tx.tenant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: 'desc' },
        skip: 40,
        take: 20,
      }),
    );
  });

  it('devuelve los datos del tenant, quién lo dio de alta y su restaurante', async () => {
    const resultado = await service.listar(1);

    expect(resultado).toEqual({
      pagina: 1,
      tamanoPagina: 20,
      total: 2,
      items: [
        {
          tenantId: T1,
          razonSocial: 'Uno SRL',
          rut: '210000000001',
          plan: 'BASICO',
          creadoPor: 'dev-daiana-plataforma',
          creadoEl: CREADO,
          restaurante: { id: 'r-1', nombre: 'Restaurante Uno' },
        },
        {
          tenantId: T2,
          razonSocial: 'Dos SRL',
          rut: '210000000002',
          plan: 'BASICO',
          creadoPor: null,
          creadoEl: CREADO,
          restaurante: null,
        },
      ],
    });
  });

  it('lee el restaurante de cada tenant dentro del contexto de ESE tenant (RLS)', async () => {
    await service.listar(1);

    // El primero es el contexto provisorio de la lista de tenants.
    expect(contextos.slice(1)).toEqual([T1, T2]);
    expect(contextos[0]).not.toBe(T1);
    expect(contextos[0]).not.toBe(T2);
    expect(tx.restaurante.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: T1 } }),
    );
  });

  it('no devuelve contraseñas ni datos de usuarios', async () => {
    const resultado = await service.listar(1);
    const texto = JSON.stringify(resultado);

    expect(texto).not.toMatch(/password/i);
    expect(texto).not.toContain('usuarios');
  });
});
