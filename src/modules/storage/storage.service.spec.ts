import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';
import { AppLogger } from '../../libs/logger';
import { config } from '../../libs/config';

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();

  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

describe('StorageService', () => {
  const originalConfig = {
    AWS_REGION: config.AWS_REGION,
    AWS_S3_BUCKET: config.AWS_S3_BUCKET,
    AWS_ACCESS_KEY_ID: config.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: config.AWS_SECRET_ACCESS_KEY,
  };

  let service: StorageService;
  let logger: jest.Mocked<AppLogger>;
  let sendMock: jest.Mock;

  beforeEach(() => {
    config.AWS_REGION = 'ap-southeast-1';
    config.AWS_S3_BUCKET = 'avatar-bucket';
    config.AWS_ACCESS_KEY_ID = 'key';
    config.AWS_SECRET_ACCESS_KEY = 'secret';

    logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLogger>;

    service = new StorageService(logger);
    sendMock = (S3Client as unknown as jest.Mock).mock.results.at(-1)?.value
      .send as jest.Mock;
    sendMock.mockReset();
  });

  afterAll(() => {
    config.AWS_REGION = originalConfig.AWS_REGION;
    config.AWS_S3_BUCKET = originalConfig.AWS_S3_BUCKET;
    config.AWS_ACCESS_KEY_ID = originalConfig.AWS_ACCESS_KEY_ID;
    config.AWS_SECRET_ACCESS_KEY = originalConfig.AWS_SECRET_ACCESS_KEY;
  });

  it('uploads avatars using file.buffer and a deterministic public url', async () => {
    sendMock.mockResolvedValue({});
    const file = {
      mimetype: 'image/png',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    const result = await service.uploadUserAvatar({
      userId: 'user-1',
      file,
    });

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'avatar-bucket',
        Body: file.buffer,
        ContentType: 'image/png',
      }),
    );
    expect(result.key).toMatch(/^users\/user-1\/avatar\/.+\.png$/);
    expect(result.url).toBe(
      `https://avatar-bucket.s3.ap-southeast-1.amazonaws.com/${result.key}`,
    );
  });

  it('rejects unsupported mime types', async () => {
    const file = {
      mimetype: 'text/plain',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    await expect(
      service.uploadUserAvatar({
        userId: 'user-1',
        file,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes uploaded objects by key', async () => {
    sendMock.mockResolvedValue({});

    await service.deleteObject('users/user-1/avatar/file.jpg');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'avatar-bucket',
      Key: 'users/user-1/avatar/file.jpg',
    });
  });

  it('fails when required aws config is missing', async () => {
    config.AWS_S3_BUCKET = '';
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    await expect(
      service.uploadUserAvatar({
        userId: 'user-1',
        file,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
