import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { config } from '../../libs/config';
import { AppLogger } from '../../libs/logger';
import { StorageService } from './storage.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

describe('StorageService', () => {
  const originalConfig = {
    CLOUDINARY_CLOUD_NAME: config.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: config.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: config.CLOUDINARY_API_SECRET,
  };

  let service: StorageService;
  let logger: jest.Mocked<AppLogger>;
  let uploadStreamMock: jest.Mock;
  let destroyMock: jest.Mock;

  beforeEach(() => {
    config.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    config.CLOUDINARY_API_KEY = 'api-key';
    config.CLOUDINARY_API_SECRET = 'api-secret';

    logger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLogger>;

    service = new StorageService(logger);
    uploadStreamMock = cloudinary.uploader.upload_stream as jest.Mock;
    destroyMock = cloudinary.uploader.destroy as jest.Mock;

    uploadStreamMock.mockReset();
    destroyMock.mockReset();
    (cloudinary.config as jest.Mock).mockReset();
  });

  afterAll(() => {
    config.CLOUDINARY_CLOUD_NAME = originalConfig.CLOUDINARY_CLOUD_NAME;
    config.CLOUDINARY_API_KEY = originalConfig.CLOUDINARY_API_KEY;
    config.CLOUDINARY_API_SECRET = originalConfig.CLOUDINARY_API_SECRET;
  });

  it('uploads avatars from file.buffer and returns secure_url plus public_id', async () => {
    const file = {
      mimetype: 'image/png',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    uploadStreamMock.mockImplementation((options, callback) => ({
      end: jest.fn((buffer: Buffer) => {
        expect(buffer).toBe(file.buffer);
        callback(undefined, {
          public_id: 'users/user-1/avatar/1234-uuid',
          secure_url:
            'https://res.cloudinary.com/demo-cloud/image/upload/v1234/users/user-1/avatar/1234-uuid.png',
        });
      }),
    }));

    const result = await service.uploadUserAvatar({
      userId: 'user-1',
      file,
    });

    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: 'demo-cloud',
      api_key: 'api-key',
      api_secret: 'api-secret',
    });
    expect(uploadStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: 'image',
        folder: 'users/user-1/avatar',
        overwrite: false,
        format: 'png',
      }),
      expect.any(Function),
    );
    expect(result).toEqual({
      url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1234/users/user-1/avatar/1234-uuid.png',
      key: 'users/user-1/avatar/1234-uuid',
      contentType: 'image/png',
    });
  });

  it('rejects when the Cloudinary upload callback returns an error', async () => {
    const file = {
      mimetype: 'image/jpeg',
      buffer: Buffer.from('avatar'),
    } as Express.Multer.File;

    uploadStreamMock.mockImplementation((_options, callback) => ({
      end: jest.fn(() => {
        callback(new Error('upload failed'));
      }),
    }));

    await expect(
      service.uploadUserAvatar({
        userId: 'user-1',
        file,
      }),
    ).rejects.toThrow('upload failed');
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

  it('requires an in-memory file buffer', async () => {
    const file = {
      mimetype: 'image/webp',
    } as Express.Multer.File;

    await expect(
      service.uploadUserAvatar({
        userId: 'user-1',
        file,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('deletes uploaded assets by public_id', async () => {
    destroyMock.mockResolvedValue({ result: 'ok' });

    await service.deleteObject('users/user-1/avatar/1234-uuid');

    expect(destroyMock).toHaveBeenCalledWith('users/user-1/avatar/1234-uuid', {
      resource_type: 'image',
    });
  });

  it('fails when required Cloudinary config is missing', async () => {
    config.CLOUDINARY_API_SECRET = '';
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
