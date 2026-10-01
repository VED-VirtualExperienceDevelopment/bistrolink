import { Test, TestingModule } from '@nestjs/testing';
import { StorageService } from '../../src/menu/storage.service';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('@aws-sdk/s3-presigned-post');

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
      (getSignedUrl as jest.Mock).mockRejectedValue(new Error('Signing failed'));

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
  });

  describe('getPresignedPostUrl', () => {
    it('should return presigned POST URL with correct parameters', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      const mockPresignedData = { url: 'https://s3.amazonaws.com/bucket', fields: { key: 'test-key' } };
      (createPresignedPost as jest.Mock).mockResolvedValue(mockPresignedData);

      const result = await service.getPresignedPostUrl('image.jpg', 'image/jpeg', 'tenant-123');

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('fields');
      expect(result).toHaveProperty('key');
      expect(result.key).toContain('tenant-123/menu/');
      expect(createPresignedPost).toHaveBeenCalled();
    });

    it('should set correct content length range condition', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (createPresignedPost as jest.Mock).mockResolvedValue({ url: 'https://example.com', fields: {} });

      await service.getPresignedPostUrl('image.jpg', 'image/jpeg', 'tenant-1');

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Conditions: expect.arrayContaining([
            expect.arrayContaining(['content-length-range', 0, 5 * 1024 * 1024]),
          ]),
        }),
      );
    });

    it('should set correct expires time', async () => {
      process.env.S3_BUCKET_IMAGES = 'test-bucket';
      (createPresignedPost as jest.Mock).mockResolvedValue({ url: 'https://example.com', fields: {} });

      await service.getPresignedPostUrl('image.jpg', 'image/jpeg', 'tenant-1');

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Expires: 300 }),
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
