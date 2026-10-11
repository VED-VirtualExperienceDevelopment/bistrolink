import { Test, TestingModule } from '@nestjs/testing';
import { PayloadTooLargeException } from '@nestjs/common';
import { StorageService } from '../../src/menu/storage.service';
import { TipoImagenPermitido } from '../../src/menu/upload.constants';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('@aws-sdk/s3-presigned-post');

// Valores esperados escritos a mano (no importados de upload.constants):
// si alguien cambia el límite o los TTL sin querer, estos tests lo detectan.
const CINCO_MB = 5 * 1024 * 1024;
const UN_KB = 1024;

describe('StorageService', () => {
  let service: StorageService;
  let mockS3Client: any;

  beforeEach(async () => {
    mockS3Client = { send: jest.fn() };
    (S3Client as jest.Mock).mockImplementation(() => mockS3Client);

    const module: TestingModule = await Test.createTestingModule({
      providers: [StorageService],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.S3_BUCKET_IMAGES;
    delete process.env.AWS_REGION;
    delete process.env.AWS_S3_ENDPOINT;
  });

  describe('getSignedImageUrl', () => {
    it('should return signed URL when successful', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      const mockSignedUrl = 'https://signed-url.example.com';
      (getSignedUrl as jest.Mock).mockResolvedValue(mockSignedUrl);

      const result = await service.getSignedImageUrl('test-key.jpg');

      expect(result).toBe(mockSignedUrl);
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('should return null when signing fails', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (getSignedUrl as jest.Mock).mockRejectedValue(
        new Error('Signing failed'),
      );

      const result = await service.getSignedImageUrl('test-key.jpg');

      expect(result).toBeNull();
    });

    it('should use correct bucket from environment variable', async () => {
      process.env.S3_BUCKET_IMAGES = 'my-images-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com');

      await service.getSignedImageUrl('test-key.jpg');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-images-bucket',
        Key: 'test-key.jpg',
      });
    });

    // BL-54: la URL de lectura es temporal (1 hora), no permanente.
    it('should sign the read URL with a 1 hour TTL', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com');

      await service.getSignedImageUrl('test-key.jpg');

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 },
      );
    });
  });

  describe('getPresignedPostUrl', () => {
    beforeEach(() => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (createPresignedPost as jest.Mock).mockResolvedValue({
        url: 'https://example.com',
        fields: {},
      });
    });

    it('should return presigned POST URL with correct parameters', async () => {
      const mockPresignedData = {
        url: 'https://s3.amazonaws.com/bucket',
        fields: { key: 'test-key' },
      };
      (createPresignedPost as jest.Mock).mockResolvedValue(mockPresignedData);

      const result = await service.getPresignedPostUrl(
        'image/jpeg',
        UN_KB,
        'tenant-123',
      );

      expect(result.url).toBe(mockPresignedData.url);
      expect(result.fields).toEqual(mockPresignedData.fields);
      expect(result.key).toContain('tenant-123/menu/');
      expect(createPresignedPost).toHaveBeenCalled();
    });

    // BL-54: la key no usa el nombre del archivo del cliente; es
    // tenant/menu/<uuid>.<extensión derivada del MIME>.
    it.each<[TipoImagenPermitido, string]>([
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ])(
      'should build the key as tenant/menu/uuid.ext for %s',
      async (contentType, extension) => {
        const result = await service.getPresignedPostUrl(
          contentType,
          UN_KB,
          'tenant-123',
        );

        expect(result.key).toMatch(
          new RegExp(`^tenant-123/menu/[0-9a-f-]{36}\\.${extension}$`),
        );
      },
    );

    it('should generate a different key on each call', async () => {
      const a = await service.getPresignedPostUrl('image/png', UN_KB, 't');
      const b = await service.getPresignedPostUrl('image/png', UN_KB, 't');

      expect(a.key).not.toBe(b.key);
    });

    // BL-54: mínimo 1 byte (no se aceptan archivos vacíos), máximo 5 MB.
    it('should set content length range from 1 byte to 5 MB', async () => {
      await service.getPresignedPostUrl('image/jpeg', UN_KB, 'tenant-1');

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Conditions: expect.arrayContaining([
            ['content-length-range', 1, CINCO_MB],
          ]),
        }),
      );
    });

    it('should set correct expires time', async () => {
      await service.getPresignedPostUrl('image/jpeg', UN_KB, 'tenant-1');

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Expires: 300 }),
      );
    });

    // BL-257: si Content-Type está en Conditions pero no en Fields, el
    // formulario no lo envía y S3 rechaza la subida con 403 (Policy Condition failed).
    it.each<TipoImagenPermitido>(['image/jpeg', 'image/png', 'image/webp'])(
      'should include Content-Type %s both in Conditions and in Fields',
      async (contentType) => {
        await service.getPresignedPostUrl(contentType, UN_KB, 'tenant-1');

        expect(createPresignedPost).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            Conditions: expect.arrayContaining([
              ['eq', '$Content-Type', contentType],
            ]),
            Fields: { 'Content-Type': contentType },
          }),
        );
      },
    );

    // BL-54: imágenes de más de 5 MB se rechazan con 413 sin firmar nada.
    it('should throw PayloadTooLargeException (413) when the image exceeds 5 MB', async () => {
      await expect(
        service.getPresignedPostUrl('image/jpeg', CINCO_MB + 1, 'tenant-1'),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(createPresignedPost).not.toHaveBeenCalled();
    });

    it('should respond with HTTP status 413', async () => {
      await expect(
        service.getPresignedPostUrl('image/jpeg', CINCO_MB + 1, 'tenant-1'),
      ).rejects.toMatchObject({ status: 413 });
    });

    it('should accept an image of exactly 5 MB', async () => {
      await expect(
        service.getPresignedPostUrl('image/jpeg', CINCO_MB, 'tenant-1'),
      ).resolves.toHaveProperty('key');

      expect(createPresignedPost).toHaveBeenCalledTimes(1);
    });
  });

  // BL-54: un tenant no puede guardar la key de una imagen de otro tenant.
  describe('esKeyDelTenant', () => {
    it('should accept a key under the tenant prefix', () => {
      expect(
        service.esKeyDelTenant('tenant-123/menu/abc.jpg', 'tenant-123'),
      ).toBe(true);
    });

    it('should accept keys with the previous naming format', () => {
      expect(
        service.esKeyDelTenant(
          'tenant-123/menu/abc-foto_pizza.jpg',
          'tenant-123',
        ),
      ).toBe(true);
    });

    it.each([
      ['de otro tenant', 'otro-tenant/menu/abc.jpg'],
      ['con un prefijo que empieza igual', 'tenant-1234/menu/abc.jpg'],
      ['fuera de la carpeta menu', 'tenant-123/otra/abc.jpg'],
      ['con path traversal', 'tenant-123/menu/../../otro-tenant/menu/x.jpg'],
      ['vacía', ''],
    ])('should reject a key %s', (_caso, key) => {
      expect(service.esKeyDelTenant(key, 'tenant-123')).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should create S3 client with correct configuration when env vars are set', () => {
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_ENDPOINT = 'https://r2.example.com';

      const serviceWithEnv = new StorageService();
      (serviceWithEnv as any).getClient();

      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'https://r2.example.com',
        forcePathStyle: true,
      });
    });

    it('should use default region when env vars are not provided', () => {
      // Aseguramos que no existan
      delete process.env.AWS_REGION;
      delete process.env.AWS_S3_ENDPOINT;

      const serviceWithEnv = new StorageService();
      (serviceWithEnv as any).getClient();

      expect(S3Client).toHaveBeenCalledWith({
        region: 'auto',
        endpoint: undefined,
        forcePathStyle: false,
      });
    });

    it('should return cached client on subsequent calls', () => {
      const serviceWithEnv = new StorageService();
      const client1 = (serviceWithEnv as any).getClient();
      const client2 = (serviceWithEnv as any).getClient();

      expect(client1).toBe(client2);
      expect(S3Client).toHaveBeenCalledTimes(1);
    });
  });
});
