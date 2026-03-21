import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { AppLogger } from '../../libs/logger';
import { config } from '../../libs/config';

type UploadUserAvatarParams = {
  userId: string;
  file: Express.Multer.File;
};

type UploadUserAvatarResult = {
  url: string;
  key: string;
  contentType: string;
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@Injectable()
export class StorageService {
  private readonly context = StorageService.name;
  private readonly s3Client: S3Client;

  constructor(private readonly logger: AppLogger) {
    this.s3Client = new S3Client({
      region: config.AWS_REGION || undefined,
      credentials:
        config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.AWS_ACCESS_KEY_ID,
              secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async uploadUserAvatar(
    params: UploadUserAvatarParams,
  ): Promise<UploadUserAvatarResult> {
    this.assertConfigured();

    const contentType = this.resolveContentType(params.file.mimetype);
    const key = this.buildAvatarKey(params.userId, contentType);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: config.AWS_S3_BUCKET,
        Key: key,
        Body: params.file.buffer,
        ContentType: contentType,
      }),
    );

    this.logger.debug(
      `[${this.context}] Uploaded user avatar`,
      { userId: params.userId, key },
      this.context,
    );

    return {
      url: this.buildPublicUrl(key),
      key,
      contentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.assertConfigured();

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: config.AWS_S3_BUCKET,
        Key: key,
      }),
    );

    this.logger.debug(
      `[${this.context}] Deleted S3 object`,
      { key },
      this.context,
    );
  }

  private assertConfigured(): void {
    const missing = [
      ['AWS_REGION', config.AWS_REGION],
      ['AWS_S3_BUCKET', config.AWS_S3_BUCKET],
      ['AWS_ACCESS_KEY_ID', config.AWS_ACCESS_KEY_ID],
      ['AWS_SECRET_ACCESS_KEY', config.AWS_SECRET_ACCESS_KEY],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `Storage service is not configured: missing ${missing.join(', ')}`,
      );
    }
  }

  private resolveContentType(mimeType: string): string {
    if (!MIME_EXTENSION_MAP[mimeType]) {
      throw new BadRequestException('Unsupported avatar file type');
    }

    return mimeType;
  }

  private buildAvatarKey(userId: string, mimeType: string): string {
    const extension = MIME_EXTENSION_MAP[mimeType];
    return `users/${userId}/avatar/${Date.now()}-${randomUUID()}${extension}`;
  }

  private buildPublicUrl(key: string): string {
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return `https://${config.AWS_S3_BUCKET}.s3.${config.AWS_REGION}.amazonaws.com/${encodedKey}`;
  }
}
