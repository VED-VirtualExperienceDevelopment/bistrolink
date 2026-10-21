import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { StorageService } from '../../src/menu/storage.service';
import { TipoImagenPermitido } from '../../src/menu/upload.constants';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
        ResponseContentDisposition: 'inline',
      });
    });

    // BL-387: el tipo de la respuesta lo fija la firma, no quien subió.
    it('should force image/webp and inline for processed images', async () => {
      process.env.S3_BUCKET_IMAGES = 'my-images-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com');

      await service.getSignedImageUrl('tenant-1/menu/abc.webp');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-images-bucket',
        Key: 'tenant-1/menu/abc.webp',
        ResponseContentDisposition: 'inline',
        ResponseContentType: 'image/webp',
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
      expect(result.key).toContain('incoming/tenant-123/');
      expect(createPresignedPost).toHaveBeenCalled();
    });

    // BL-54 y BL-385: la key no usa el nombre del archivo del cliente; va a
    // la cuarentena como incoming/<tenant>/<uuid>, sin extensión.
    it.each<TipoImagenPermitido>(['image/jpeg', 'image/png', 'image/webp'])(
      'should build the quarantine key as incoming/tenant/uuid for %s',
      async (contentType) => {
        const result = await service.getPresignedPostUrl(
          contentType,
          UN_KB,
          'tenant-123',
        );

        expect(result.key).toMatch(
          /^incoming\/tenant-123\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
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

  // BL-54 y BL-387: solo imágenes publicadas del propio tenant.
  describe('esKeyDelTenant', () => {
    const UUID = '0b4f6a3e-1111-4c2d-9e8f-123456789abc';

    it('should accept a processed image of the tenant', () => {
      expect(
        service.esKeyDelTenant(`tenant-123/menu/${UUID}.webp`, 'tenant-123'),
      ).toBe(true);
    });

    it.each([
      ['de otro tenant', `otro-tenant/menu/${UUID}.webp`],
      ['con un prefijo que empieza igual', `tenant-1234/menu/${UUID}.webp`],
      ['fuera de la carpeta menu', `tenant-123/otra/${UUID}.webp`],
      ['de la cuarentena', `incoming/tenant-123/${UUID}`],
      ['sin procesar (jpg)', `tenant-123/menu/${UUID}.jpg`],
      ['con el formato de nombre anterior', 'tenant-123/menu/abc-foto.webp'],
      ['con barras extra', `tenant-123/menu/x/${UUID}.webp`],
      ['con path traversal', `tenant-123/menu/../otro-tenant/${UUID}.webp`],
      ['vacía', ''],
    ])('should reject a key %s', (_caso, key) => {
      expect(service.esKeyDelTenant(key, 'tenant-123')).toBe(false);
    });
  });

  // BL-387: la key tiene que existir en el bucket.
  // BL-391 (BL-386): la key de cuarentena se valida con el formato exacto.
  describe('uuidDeKeyDeCuarentena', () => {
    const TENANT = '11111111-1111-4111-8111-111111111111';
    const UUID = '0b4f6a3e-1111-4c2d-9e8f-123456789abc';

    it('devuelve el uuid de una key de cuarentena del tenant', () => {
      expect(
        service.uuidDeKeyDeCuarentena(`incoming/${TENANT}/${UUID}`, TENANT),
      ).toBe(UUID);
    });

    it.each([
      [
        'de otro tenant',
        `incoming/22222222-2222-4222-8222-222222222222/${UUID}`,
      ],
      ['publicada (no de cuarentena)', `${TENANT}/menu/${UUID}.webp`],
      ['con extensión', `incoming/${TENANT}/${UUID}.jpg`],
      ['con barras extra', `incoming/${TENANT}/x/${UUID}`],
      ['con path traversal', `incoming/${TENANT}/../${UUID}`],
      ['con mayúsculas en el uuid', `incoming/${TENANT}/${UUID.toUpperCase()}`],
      ['vacía', ''],
    ])('rechaza una key %s', (_caso, key) => {
      expect(service.uuidDeKeyDeCuarentena(key, TENANT)).toBeNull();
    });

    it('un tenant con caracteres especiales no rompe la expresión regular', () => {
      expect(service.uuidDeKeyDeCuarentena(`incoming/a.b/${UUID}`, 'a.b')).toBe(
        UUID,
      );
      expect(
        service.uuidDeKeyDeCuarentena(`incoming/aXb/${UUID}`, 'a.b'),
      ).toBeNull();
    });
  });

  // BL-391 (BL-386): el tamaño real se consulta antes de descargar.
  describe('leerDeCuarentena', () => {
    beforeEach(() => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
    });

    it('lee el archivo si existe y pesa hasta 5 MB', async () => {
      mockS3Client.send
        .mockResolvedValueOnce({ ContentLength: UN_KB })
        .mockResolvedValueOnce({
          Body: {
            transformToByteArray: () => Promise.resolve(Buffer.from('imagen')),
          },
        });

      const contenido = await service.leerDeCuarentena('incoming/t/u');

      expect(contenido.toString()).toBe('imagen');
      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'incoming/t/u',
      });
    });

    it('413 sin descargar si el tamaño real pasa de 5 MB', async () => {
      mockS3Client.send.mockResolvedValueOnce({ ContentLength: CINCO_MB + 1 });

      await expect(service.leerDeCuarentena('incoming/t/u')).rejects.toThrow(
        PayloadTooLargeException,
      );
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
      expect(GetObjectCommand).not.toHaveBeenCalled();
    });

    it('404 si S3 responde sin contenido', async () => {
      mockS3Client.send
        .mockResolvedValueOnce({ ContentLength: UN_KB })
        .mockResolvedValueOnce({ Body: undefined });

      await expect(service.leerDeCuarentena('incoming/t/u')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('413 si S3 no informa el tamaño', async () => {
      mockS3Client.send.mockResolvedValueOnce({});

      await expect(service.leerDeCuarentena('incoming/t/u')).rejects.toThrow(
        PayloadTooLargeException,
      );
    });

    it('404 si el archivo no existe (no se subió o venció)', async () => {
      mockS3Client.send.mockRejectedValueOnce({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });

      await expect(service.leerDeCuarentena('incoming/t/u')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propaga otros errores de S3', async () => {
      mockS3Client.send.mockRejectedValueOnce(new Error('AccessDenied'));

      await expect(service.leerDeCuarentena('incoming/t/u')).rejects.toThrow(
        'AccessDenied',
      );
    });
  });

  // BL-391 (BL-386): el tipo y la caché los fija el servidor.
  describe('guardarImagenPublicada', () => {
    it('guarda con Content-Type image/webp y Cache-Control fijados por la API', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      mockS3Client.send.mockResolvedValueOnce({});
      const contenido = Buffer.from('webp');

      await service.guardarImagenPublicada('t/menu/u.webp', contenido);

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 't/menu/u.webp',
        Body: contenido,
        ContentType: 'image/webp',
        CacheControl: 'private, max-age=3600',
      });
    });
  });

  describe('existeImagen', () => {
    beforeEach(() => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
    });

    it('should return true when the object exists', async () => {
      mockS3Client.send.mockResolvedValue({ ContentLength: 100 });

      await expect(service.existeImagen('k.webp')).resolves.toBe(true);
      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'k.webp',
      });
    });

    it('should return false when S3 answers 404', async () => {
      mockS3Client.send.mockRejectedValue({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });

      await expect(service.existeImagen('k.webp')).resolves.toBe(false);
    });

    it('should rethrow other S3 errors', async () => {
      mockS3Client.send.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.existeImagen('k.webp')).rejects.toThrow(
        'AccessDenied',
      );
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
