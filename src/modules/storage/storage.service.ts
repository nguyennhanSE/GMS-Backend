import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
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

type CloudinaryUploadResult = {
  public_id?: string;
  secure_url?: string;
};

type RejectWithError = (reason: Error) => void;

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class StorageService {
  private readonly context = StorageService.name;

  constructor(private readonly logger: AppLogger) {}

  async uploadUserAvatar(
    params: UploadUserAvatarParams,
  ): Promise<UploadUserAvatarResult> {
    this.assertConfigured();

    const contentType = this.resolveContentType(params.file.mimetype);
    const upload = await this.uploadBuffer({
      userId: params.userId,
      file: params.file,
      contentType,
    });

    this.logger.debug(
      `[${this.context}] Uploaded user avatar to Cloudinary`,
      { userId: params.userId, key: upload.public_id },
      this.context,
    );

    return {
      url: upload.secure_url,
      key: upload.public_id,
      contentType,
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.assertConfigured();

    await cloudinary.uploader.destroy(key, {
      resource_type: 'image',
    });

    this.logger.debug(
      `[${this.context}] Deleted Cloudinary asset`,
      { key },
      this.context,
    );
  }

  private assertConfigured(): void {
    const missing = [
      ['CLOUDINARY_CLOUD_NAME', config.CLOUDINARY_CLOUD_NAME],
      ['CLOUDINARY_API_KEY', config.CLOUDINARY_API_KEY],
      ['CLOUDINARY_API_SECRET', config.CLOUDINARY_API_SECRET],
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new InternalServerErrorException(
        `Storage service is not configured: missing ${missing.join(', ')}`,
      );
    }

    cloudinary.config({
      cloud_name: config.CLOUDINARY_CLOUD_NAME,
      api_key: config.CLOUDINARY_API_KEY,
      api_secret: config.CLOUDINARY_API_SECRET,
    });
  }

  private resolveContentType(mimeType: string): string {
    if (!MIME_EXTENSION_MAP[mimeType]) {
      throw new BadRequestException('Unsupported avatar file type');
    }

    return mimeType;
  }

  private async uploadBuffer(params: {
    userId: string;
    file: Express.Multer.File;
    contentType: string;
  }): Promise<{ public_id: string; secure_url: string }> {
    if (!params.file.buffer) {
      throw new InternalServerErrorException(
        'Avatar upload requires an in-memory file buffer',
      );
    }

    const publicId = `${Date.now()}-${randomUUID()}`;

    const result = await new Promise<CloudinaryUploadResult>(
      (resolve, reject: RejectWithError) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'image',
            folder: `users/${params.userId}/avatar`,
            public_id: publicId,
            overwrite: false,
            format: MIME_EXTENSION_MAP[params.contentType],
          },
          (error, uploadResult) => {
          if (error) {
            const uploadError =
              error instanceof Error
                ? error
                : new Error('Cloudinary upload failed');
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            reject(uploadError);
            return;
          }

          if (!uploadResult) {
            const missingResultError = new Error(
              'Cloudinary upload did not return a result',
            );
            reject(missingResultError);
            return;
          }

            resolve(uploadResult);
          },
        );

        stream.end(params.file.buffer);
      },
    );

    if (!result.public_id || !result.secure_url) {
      throw new InternalServerErrorException(
        'Cloudinary upload response is missing required fields',
      );
    }

    return {
      public_id: result.public_id,
      secure_url: result.secure_url,
    };
  }
}
