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
    delete process.env.IMAGES_CDN_URL;
  });

  describe('urlFirmadaDeLectura', () => {
    it('devuelve la URL firmada', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      const urlFirmada = 'https://signed-url.example.com';
      (getSignedUrl as jest.Mock).mockResolvedValue(urlFirmada);

      const result = await service.urlFirmadaDeLectura('test-key.jpg');

      expect(result).toBe(urlFirmada);
      expect(getSignedUrl).toHaveBeenCalled();
    });

    it('devuelve null si no se puede firmar', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (getSignedUrl as jest.Mock).mockRejectedValue(
        new Error('Signing failed'),
      );

      const result = await service.urlFirmadaDeLectura('test-key.jpg');

      expect(result).toBeNull();
    });

    it('usa el bucket de la variable de entorno', async () => {
      process.env.S3_BUCKET_IMAGES = 'my-images-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com');

      await service.urlFirmadaDeLectura('test-key.jpg');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-images-bucket',
        Key: 'test-key.jpg',
        ResponseContentDisposition: 'inline',
      });
    });

    // BL-387: el tipo de la respuesta lo fija la firma, no quien subió.
    it('fuerza image/webp e inline en las imágenes procesadas', async () => {
      process.env.S3_BUCKET_IMAGES = 'my-images-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com');

      await service.urlFirmadaDeLectura('tenant-1/menu/abc.webp');

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'my-images-bucket',
        Key: 'tenant-1/menu/abc.webp',
        ResponseContentDisposition: 'inline',
        ResponseContentType: 'image/webp',
      });
    });

    // BL-54: la URL de lectura es temporal (1 hora), no permanente.
    it('firma la URL de lectura con un TTL de 1 hora', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://example.com');

      await service.urlFirmadaDeLectura('test-key.jpg');

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 },
      );
    });
  });

  describe('urlImagenPublica (BL-199)', () => {
    const KEY = 'tenant-a/menu/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.webp';

    it('devuelve la URL de la CDN, sin firma, si IMAGES_CDN_URL está definida', async () => {
      process.env.IMAGES_CDN_URL = 'https://d111111abcdef8.cloudfront.net/';

      const url = await service.urlImagenPublica(KEY);

      expect(url).toBe(`https://d111111abcdef8.cloudfront.net/${KEY}`);
      expect(url).not.toContain('X-Amz-');
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('la URL de una misma imagen es idéntica entre llamadas', async () => {
      process.env.IMAGES_CDN_URL = 'https://d111111abcdef8.cloudfront.net';

      const primera = await service.urlImagenPublica(KEY);
      const segunda = await service.urlImagenPublica(KEY);

      expect(segunda).toBe(primera);
    });

    it('sin IMAGES_CDN_URL firma la URL como antes (local y MinIO)', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://firmada.example');

      await expect(service.urlImagenPublica(KEY)).resolves.toBe(
        'https://firmada.example',
      );
    });

    it('nunca arma una URL de la CDN fuera de {tenant}/menu/{uuid}.webp', async () => {
      process.env.IMAGES_CDN_URL = 'https://cdn.example';
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (getSignedUrl as jest.Mock).mockResolvedValue('https://firmada.example');

      for (const key of [
        'incoming/tenant-a/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b',
        '../menu/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.webp',
        'tenant-a/items/milanesa.jpg',
      ]) {
        await expect(service.urlImagenPublica(key)).resolves.toBe(
          'https://firmada.example',
        );
      }
    });
  });

  describe('urlFirmadaDeSubida', () => {
    beforeEach(() => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (createPresignedPost as jest.Mock).mockResolvedValue({
        url: 'https://example.com',
        fields: {},
      });
    });

    it('devuelve la URL de subida con los parámetros correctos', async () => {
      const mockPresignedData = {
        url: 'https://s3.amazonaws.com/bucket',
        fields: { key: 'test-key' },
      };
      (createPresignedPost as jest.Mock).mockResolvedValue(mockPresignedData);

      const result = await service.urlFirmadaDeSubida(
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
      'arma la key de cuarentena como incoming/tenant/uuid para %s',
      async (contentType) => {
        const result = await service.urlFirmadaDeSubida(
          contentType,
          UN_KB,
          'tenant-123',
        );

        expect(result.key).toMatch(
          /^incoming\/tenant-123\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      },
    );

    it('genera una key distinta en cada llamada', async () => {
      const a = await service.urlFirmadaDeSubida('image/png', UN_KB, 't');
      const b = await service.urlFirmadaDeSubida('image/png', UN_KB, 't');

      expect(a.key).not.toBe(b.key);
    });

    // BL-54: mínimo 1 byte (no se aceptan archivos vacíos), máximo 5 MB.
    it('fija el rango de tamaño entre 1 byte y 5 MB', async () => {
      await service.urlFirmadaDeSubida('image/jpeg', UN_KB, 'tenant-1');

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Conditions: expect.arrayContaining([
            ['content-length-range', 1, CINCO_MB],
          ]),
        }),
      );
    });

    it('fija el vencimiento de la subida en 5 minutos', async () => {
      await service.urlFirmadaDeSubida('image/jpeg', UN_KB, 'tenant-1');

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Expires: 300 }),
      );
    });

    // BL-257: si Content-Type está en Conditions pero no en Fields, el
    // formulario no lo envía y S3 rechaza la subida con 403 (Policy Condition failed).
    it.each<TipoImagenPermitido>(['image/jpeg', 'image/png', 'image/webp'])(
      'incluye el Content-Type %s en Conditions y en Fields',
      async (contentType) => {
        await service.urlFirmadaDeSubida(contentType, UN_KB, 'tenant-1');

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
    it('lanza PayloadTooLargeException (413) si la imagen supera 5 MB', async () => {
      await expect(
        service.urlFirmadaDeSubida('image/jpeg', CINCO_MB + 1, 'tenant-1'),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(createPresignedPost).not.toHaveBeenCalled();
    });

    it('responde con el estado HTTP 413', async () => {
      await expect(
        service.urlFirmadaDeSubida('image/jpeg', CINCO_MB + 1, 'tenant-1'),
      ).rejects.toMatchObject({ status: 413 });
    });

    it('acepta una imagen de exactamente 5 MB', async () => {
      await expect(
        service.urlFirmadaDeSubida('image/jpeg', CINCO_MB, 'tenant-1'),
      ).resolves.toHaveProperty('key');

      expect(createPresignedPost).toHaveBeenCalledTimes(1);
    });
  });

  // BL-54 y BL-387: solo imágenes publicadas del propio tenant.
  describe('esKeyDelTenant', () => {
    const UUID = '0b4f6a3e-1111-4c2d-9e8f-123456789abc';

    it('acepta una imagen procesada del tenant', () => {
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
    ])('rechaza una key %s', (_caso, key) => {
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
        CacheControl: 'public, max-age=31536000, immutable',
      });
    });
  });

  describe('existeImagen', () => {
    beforeEach(() => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
    });

    it('devuelve true si el objeto existe', async () => {
      mockS3Client.send.mockResolvedValue({ ContentLength: 100 });

      await expect(service.existeImagen('k.webp')).resolves.toBe(true);
      expect(HeadObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'k.webp',
      });
    });

    it('devuelve false si S3 responde 404', async () => {
      mockS3Client.send.mockRejectedValue({
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      });

      await expect(service.existeImagen('k.webp')).resolves.toBe(false);
    });

    it('propaga otros errores de S3', async () => {
      mockS3Client.send.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.existeImagen('k.webp')).rejects.toThrow(
        'AccessDenied',
      );
    });
  });

  describe('obtenerCliente', () => {
    it('crea el cliente de S3 con la configuración de las variables de entorno', () => {
      process.env.AWS_REGION = 'us-east-1';
      process.env.AWS_S3_ENDPOINT = 'https://r2.example.com';

      const serviceWithEnv = new StorageService();
      (serviceWithEnv as any).obtenerCliente();

      expect(S3Client).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'https://r2.example.com',
        forcePathStyle: true,
      });
    });

    it('usa la región por defecto si no hay variables de entorno', () => {
      // Aseguramos que no existan
      delete process.env.AWS_REGION;
      delete process.env.AWS_S3_ENDPOINT;

      const serviceWithEnv = new StorageService();
      (serviceWithEnv as any).obtenerCliente();

      expect(S3Client).toHaveBeenCalledWith({
        region: 'auto',
        endpoint: undefined,
        forcePathStyle: false,
      });
    });

    it('reutiliza el mismo cliente en las llamadas siguientes', () => {
      const serviceWithEnv = new StorageService();
      const client1 = (serviceWithEnv as any).obtenerCliente();
      const client2 = (serviceWithEnv as any).obtenerCliente();

      expect(client1).toBe(client2);
      expect(S3Client).toHaveBeenCalledTimes(1);
    });
  });
});
