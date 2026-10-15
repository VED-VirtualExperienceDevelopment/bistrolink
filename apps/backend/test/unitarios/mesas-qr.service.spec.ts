import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { MesasQrService } from '../../src/mesas/mesas-qr.service';
import { QrMesaTokenService } from '../../src/qr-mesa/qr-mesa-token.service';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID_AJENO = 'aaaaaaaa-0000-0000-0000-000000000001';
const RESTAURANTE_ID = '22222222-2222-2222-2222-222222222222';
const MESA_ID = '33333333-3333-3333-3333-333333333333';
const MESA_ID_2 = '44444444-4444-4444-4444-444444444444';
const ACTOR = 'c832535d-6122-449d-8b21-2371d8b7d9d0';
const FRONTEND = 'https://app.bistrolink.test';

describe('MesasQrService (BL-204)', () => {
  const qrTokenKeyOriginal = process.env.QR_TOKEN_KEY;
  const frontendUrlOriginal = process.env.FRONTEND_URL;

  let tx: any;
  let mockTenantPrisma: any;
  let qrToken: QrMesaTokenService;
  let service: MesasQrService;

  beforeEach(() => {
    process.env.QR_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.FRONTEND_URL = FRONTEND;

    tx = {
      restaurante: { findUnique: jest.fn() },
      mesa: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockTenantPrisma = {
      runInTenantContext: jest.fn((_tenantId, callback) => callback(tx)),
    };
    qrToken = new QrMesaTokenService();
    service = new MesasQrService(mockTenantPrisma, qrToken);
  });

  afterEach(() => {
    if (qrTokenKeyOriginal === undefined) delete process.env.QR_TOKEN_KEY;
    else process.env.QR_TOKEN_KEY = qrTokenKeyOriginal;
    if (frontendUrlOriginal === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = frontendUrlOriginal;
  });

  /** Extrae el token de una URL /q/<token>, verificando el prefijo. */
  function tokenDe(url: string): string {
    const prefijo = `${FRONTEND}/q/`;
    expect(url.startsWith(prefijo)).toBe(true);
    return url.slice(prefijo.length);
  }

  describe('listar', () => {
    beforeEach(() => {
      tx.restaurante.findUnique.mockResolvedValue({
        id: RESTAURANTE_ID,
        nombre: 'Restaurante A',
        tenantId: TENANT_ID,
      });
      tx.mesa.findMany.mockResolvedValue([
        { id: MESA_ID, numero: 1, qrVersion: 1 },
        { id: MESA_ID_2, numero: 2, qrVersion: 3 },
      ]);
    });

    it('devuelve una URL /q/<token> por mesa que descifra a esa mesa y su versión', async () => {
      const resultado = await service.listar(TENANT_ID, RESTAURANTE_ID);

      expect(resultado.mesas.map((m) => m.numero)).toEqual([1, 2]);
      expect(qrToken.descifrar(tokenDe(resultado.mesas[0].url))).toEqual({
        tenantId: TENANT_ID,
        mesaId: MESA_ID,
        version: 1,
      });
      expect(qrToken.descifrar(tokenDe(resultado.mesas[1].url))).toEqual({
        tenantId: TENANT_ID,
        mesaId: MESA_ID_2,
        version: 3,
      });
    });

    it('las URLs de mesa no contienen ids internos', async () => {
      const resultado = await service.listar(TENANT_ID, RESTAURANTE_ID);

      for (const mesa of resultado.mesas) {
        expect(mesa.url).not.toContain(TENANT_ID);
        expect(mesa.url).not.toContain(RESTAURANTE_ID);
        expect(mesa.url).not.toContain(mesa.id);
      }
    });

    it('incluye el nombre del local y su link web', async () => {
      const resultado = await service.listar(TENANT_ID, RESTAURANTE_ID);

      expect(resultado.restaurante).toEqual({
        id: RESTAURANTE_ID,
        nombre: 'Restaurante A',
        urlWeb: `${FRONTEND}/m/${TENANT_ID}/restaurante/${RESTAURANTE_ID}`,
      });
    });

    it('excluye la mesa virtual y ordena por número', async () => {
      await service.listar(TENANT_ID, RESTAURANTE_ID);

      expect(tx.mesa.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          restauranteId: RESTAURANTE_ID,
          esVirtual: false,
        },
        select: { id: true, numero: true, qrVersion: true },
        orderBy: { numero: 'asc' },
      });
    });

    it('quita la barra final de FRONTEND_URL', async () => {
      process.env.FRONTEND_URL = `${FRONTEND}/`;

      const resultado = await service.listar(TENANT_ID, RESTAURANTE_ID);

      expect(resultado.mesas[0].url.startsWith(`${FRONTEND}/q/`)).toBe(true);
      expect(resultado.mesas[0].url).not.toContain('//q/');
    });

    it.each([
      ['no existe', null],
      [
        'es de otro tenant',
        { id: RESTAURANTE_ID, nombre: 'Otro', tenantId: TENANT_ID_AJENO },
      ],
    ])('404 si el restaurante %s', async (_caso, restaurante) => {
      tx.restaurante.findUnique.mockResolvedValue(restaurante);

      await expect(service.listar(TENANT_ID, RESTAURANTE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.mesa.findMany).not.toHaveBeenCalled();
    });

    it('500 sin consultar la base si falta FRONTEND_URL', async () => {
      delete process.env.FRONTEND_URL;

      await expect(service.listar(TENANT_ID, RESTAURANTE_ID)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(mockTenantPrisma.runInTenantContext).not.toHaveBeenCalled();
    });
  });

  describe('regenerar', () => {
    it('suma 1 a la versión y devuelve la URL nueva', async () => {
      tx.mesa.findUnique.mockResolvedValue({
        id: MESA_ID,
        tenantId: TENANT_ID,
        esVirtual: false,
      });
      tx.mesa.update.mockResolvedValue({
        id: MESA_ID,
        numero: 1,
        qrVersion: 2,
      });

      const resultado = await service.regenerar(TENANT_ID, MESA_ID, ACTOR);

      expect(tx.mesa.update).toHaveBeenCalledWith({
        where: { id: MESA_ID },
        data: { qrVersion: { increment: 1 } },
        select: { id: true, numero: true, qrVersion: true },
      });
      expect(resultado).toEqual({
        id: MESA_ID,
        numero: 1,
        url: expect.any(String),
      });
      expect(qrToken.descifrar(tokenDe(resultado.url))).toEqual({
        tenantId: TENANT_ID,
        mesaId: MESA_ID,
        version: 2,
      });
    });

    it('la URL nueva es distinta de la anterior', async () => {
      const tokenAnterior = qrToken.cifrar({
        tenantId: TENANT_ID,
        mesaId: MESA_ID,
        version: 1,
      });
      tx.mesa.findUnique.mockResolvedValue({
        id: MESA_ID,
        tenantId: TENANT_ID,
        esVirtual: false,
      });
      tx.mesa.update.mockResolvedValue({
        id: MESA_ID,
        numero: 1,
        qrVersion: 2,
      });

      const resultado = await service.regenerar(TENANT_ID, MESA_ID, ACTOR);

      expect(tokenDe(resultado.url)).not.toBe(tokenAnterior);
    });

    it.each([
      ['no existe', null],
      [
        'es de otro tenant',
        { id: MESA_ID, tenantId: TENANT_ID_AJENO, esVirtual: false },
      ],
      [
        'es la mesa virtual',
        { id: MESA_ID, tenantId: TENANT_ID, esVirtual: true },
      ],
    ])('404 sin tocar la versión si la mesa %s', async (_caso, mesa) => {
      tx.mesa.findUnique.mockResolvedValue(mesa);

      await expect(
        service.regenerar(TENANT_ID, MESA_ID, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(tx.mesa.update).not.toHaveBeenCalled();
    });
  });
});
