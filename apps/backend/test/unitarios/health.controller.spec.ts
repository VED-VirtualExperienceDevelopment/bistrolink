import { Test } from '@nestjs/testing';
import {
  HealthController,
  parsePostgresVersion,
  formatMigrationLabel,
  getLatestMigrationOnDisk,
} from '../../src/health.controller';

// Mockea el módulo completo de Prisma: HealthController instancia su propio
// PrismaClient de forma perezosa (getDiagnosticClient), no lo recibe
// inyectado — así que no hay forma de mockear vía DI de Nest. En su lugar,
// se mockea el constructor de PrismaClient para que $queryRawUnsafe devuelva
// datos controlados, sin tocar una base real.
const mockQueryRawUnsafe = jest.fn();
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRawUnsafe: mockQueryRawUnsafe,
  })),
}));

// getLatestMigrationOnDisk lee el filesystem real (readdirSync) — se mockea
// para no depender de que exista una carpeta prisma/migrations/ real en el
// entorno donde corren los tests unitarios (CI, distintas máquinas de dev).
jest.mock('node:fs', () => ({
  readdirSync: jest.fn(),
}));
import { readdirSync } from 'node:fs';
const mockReaddirSync = readdirSync as jest.Mock;

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  describe('check', () => {
    it('devuelve status ok', () => {
      expect(controller.check()).toEqual({ status: 'ok' });
    });
  });

  describe('parsePostgresVersion', () => {
    it('extrae "PostgreSQL X.Y" del string completo de SELECT version()', () => {
      const raw =
        'PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit';
      expect(parsePostgresVersion(raw)).toBe('PostgreSQL 18.6');
    });

    it('devuelve el string completo si el formato no matchea', () => {
      const raw = 'algo-inesperado-sin-el-formato-de-postgres';
      expect(parsePostgresVersion(raw)).toBe(raw);
    });
  });

  describe('formatMigrationLabel', () => {
    it('formatea el timestamp y reemplaza guiones bajos por espacios', () => {
      const result = formatMigrationLabel(
        '20260805143000_add_pedidos_tenant_id',
      );
      expect(result).toBe('2026-08-05_14-30 — add pedidos tenant id');
    });

    it('devuelve el nombre tal cual si no matchea el formato esperado', () => {
      const raw = 'nombre-sin-formato-de-prisma';
      expect(formatMigrationLabel(raw)).toBe(raw);
    });
  });

  describe('getLatestMigrationOnDisk', () => {
    it('devuelve la última migración en orden alfabético/cronológico', () => {
      mockReaddirSync.mockReturnValue([
        { name: '20260101000000_init', isDirectory: () => true },
        {
          name: '20260805143000_add_pedidos_tenant_id',
          isDirectory: () => true,
        },
        { name: 'migration_lock.toml', isDirectory: () => false },
      ]);
      expect(getLatestMigrationOnDisk()).toBe(
        '20260805143000_add_pedidos_tenant_id',
      );
    });

    it('devuelve null si la carpeta no tiene migraciones', () => {
      mockReaddirSync.mockReturnValue([
        { name: 'migration_lock.toml', isDirectory: () => false },
      ]);
      expect(getLatestMigrationOnDisk()).toBeNull();
    });

    it('devuelve null si la carpeta no existe (readdirSync lanza)', () => {
      mockReaddirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(getLatestMigrationOnDisk()).toBeNull();
    });
  });

  describe('version', () => {
    it('devuelve postgres, lastMigration y upToDate:true cuando todo coincide', async () => {
      mockQueryRawUnsafe
        .mockResolvedValueOnce([
          { version: 'PostgreSQL 18.6 (Debian) on x86_64' },
        ])
        .mockResolvedValueOnce([
          {
            migration_name: '20260805143000_add_pedidos_tenant_id',
            finished_at: new Date('2026-08-22T18:04:11.000Z'),
          },
        ]);
      mockReaddirSync.mockReturnValue([
        {
          name: '20260805143000_add_pedidos_tenant_id',
          isDirectory: () => true,
        },
      ]);

      const result = await controller.version();

      expect(result.postgres).toBe('PostgreSQL 18.6');
      expect(result.lastMigration).toEqual({
        name: '20260805143000_add_pedidos_tenant_id',
        label: '2026-08-05_14-30 — add pedidos tenant id',
        appliedAt: '2026-08-22T18:04:11.000Z',
      });
      expect(result.upToDate).toBe(true);
    });

    it('devuelve upToDate:false cuando la DB no tiene la última migración del disco', async () => {
      mockQueryRawUnsafe
        .mockResolvedValueOnce([{ version: 'PostgreSQL 18.6 on x86_64' }])
        .mockResolvedValueOnce([
          {
            migration_name: '20260101000000_init',
            finished_at: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]);
      mockReaddirSync.mockReturnValue([
        { name: '20260101000000_init', isDirectory: () => true },
        {
          name: '20260805143000_add_pedidos_tenant_id',
          isDirectory: () => true,
        },
      ]);

      const result = await controller.version();

      expect(result.upToDate).toBe(false);
    });

    it('devuelve "unavailable" en todos los campos si la DB no responde', async () => {
      mockQueryRawUnsafe.mockRejectedValue(new Error('connection refused'));
      mockReaddirSync.mockReturnValue([]);

      const result = await controller.version();

      expect(result.postgres).toBe('unavailable');
      expect(result.lastMigration).toBe('unavailable');
      expect(result.upToDate).toBe('unavailable');
    });

    it('devuelve upToDate:"unavailable" si no se puede leer el disco aunque la DB responda', async () => {
      mockQueryRawUnsafe
        .mockResolvedValueOnce([{ version: 'PostgreSQL 18.6 on x86_64' }])
        .mockResolvedValueOnce([
          {
            migration_name: '20260805143000_add_pedidos_tenant_id',
            finished_at: new Date('2026-08-22T18:04:11.000Z'),
          },
        ]);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = await controller.version();

      expect(result.upToDate).toBe('unavailable');
    });
  });
});
