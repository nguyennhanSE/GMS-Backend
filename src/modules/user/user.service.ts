import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserEntity } from './entities/user.entity';
import {
  CreateUserDto,
  UpdateUserDto,
  UserFilterDto,
  VerifyEmailDto,
} from './dto/user.dto';
import { UserRepository } from './repositories/user.repository';
import {
  IPaginate,
  PaginateOptions,
} from '../../libs/models/paginate/pagimate.model';
import { ERoleName } from '../roles/enums/role.enum';
import * as bcrypt from 'bcrypt';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserBannedEvent, USER_EVENTS } from 'src/common/events/user.events';
import { StorageService } from '../storage/storage.service';
import { AppLogger } from '../../libs/logger';
import { UserEmailService } from '../email/email.service';
import { JwtService } from '@nestjs/jwt';
import type { JwtSignOptions } from '@nestjs/jwt';
import { config } from '../../libs/config';
import { randomBytes } from 'crypto';
import type { RegisterMemberDto } from '../auth/dto/auth.dto';

type EmailVerificationMode = 'setup_password' | 'activate_only';
type JwtExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

type EmailVerificationTokenPayload = {
  sub: string;
  email: string;
  purpose: 'user-email-verification';
  mode: EmailVerificationMode;
};

@Injectable()
export class UserService {
  private readonly context = UserService.name;
  private static readonly EMAIL_VERIFICATION_PURPOSE =
    'user-email-verification' as const;
  private static readonly PENDING_VERIFICATION_STATUS =
    'pending_verification';
  private readonly supportedAvatarMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly storageService: StorageService,
    private readonly userEmailService: UserEmailService,
    private readonly jwtService: JwtService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Get user by account (id)
   */
  async getUserByAccount(account: string): Promise<UserEntity | null> {
    return await this.userRepository.getUserByAccount(account);
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<UserEntity | null> {
    return await this.userRepository.getUserByEmail(email);
  }

  /**
   * Create a new user with role assignment
   * Default role is MEMBER if not provided
   */
  async create(createUserDto: CreateUserDto): Promise<UserEntity> {
    const temporaryPasswordHash: string = await bcrypt.hash(
      this.generateTemporaryPassword(),
      10,
    );

    return this.createPendingVerificationUser(
      {
        ...createUserDto,
        role: createUserDto.role ?? ERoleName.MEMBER,
      },
      temporaryPasswordHash,
      'setup_password',
    );
  }

  async registerMember(registerMemberDto: RegisterMemberDto): Promise<UserEntity> {
    if (registerMemberDto.password !== registerMemberDto.confirmPassword) {
      throw new BadRequestException('Password confirmation does not match');
    }

    const hashedPassword: string = await bcrypt.hash(
      registerMemberDto.password,
      10,
    );
    const { password, confirmPassword, ...memberData } = registerMemberDto;

    return this.createPendingVerificationUser(
      {
        ...memberData,
        role: ERoleName.MEMBER,
      },
      hashedPassword,
      'activate_only',
    );
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto): Promise<UserEntity> {
    const { token, password, confirmPassword } = verifyEmailDto;

    const payload = await this.decodeVerificationToken(token);

    const user = await this.findOne(payload.sub);
    if (user.email !== payload.email) {
      throw new UnauthorizedException(
        'Verification token is invalid or expired',
      );
    }

    if (user.status === 'active') {
      throw new BadRequestException('User email is already verified');
    }

    if (user.status !== UserService.PENDING_VERIFICATION_STATUS) {
      throw new BadRequestException(
        'User cannot be verified in the current status',
      );
    }

    if (payload.mode === 'setup_password') {
      if (!password || !confirmPassword) {
        throw new BadRequestException(
          'Password and confirmPassword are required',
        );
      }

      if (password !== confirmPassword) {
        throw new BadRequestException('Password confirmation does not match');
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      return this.userRepository.updateUser(user.id, {
        status: 'active',
        password: hashedPassword,
      });
    }

    return this.userRepository.updateUser(user.id, {
      status: 'active',
    });
  }

  async getVerificationContext(token: string): Promise<{
    requiresPasswordSetup: boolean;
  }> {
    const payload = await this.decodeVerificationToken(token);
    return {
      requiresPasswordSetup: payload.mode === 'setup_password',
    };
  }

  /**
   * Get paginated users
   */
  async getUserPaginate(
    paginateRequest: PaginateOptions,
    filter: UserFilterDto,
    options: { counted?: boolean },
  ): Promise<IPaginate<UserEntity>> {
    return this.userRepository.getUserPaginate(filter, {
      ...paginateRequest,
      counted: options.counted,
    });
  }

  /**
   * Find one user by id
   */
  async findOne(id: string): Promise<UserEntity> {
    const user = await this.userRepository.getUserByAccount(id);
    if (!user) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return user;
  }

  /**
   * Update user
   */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserEntity> {
    // Check if user exists
    const existingUser = await this.findOne(id);

    // Check if email is being updated and if it's already taken by another user
    if (updateUserDto.email) {
      const emailUser = await this.userRepository.getUserByEmail(
        updateUserDto.email,
      );
      if (emailUser && emailUser.id !== id) {
        throw new BadRequestException('Email is already taken by another user');
      }
    }

    // Hash password if provided
    let hashedPassword: string | undefined;
    if (updateUserDto.password) {
      hashedPassword = await bcrypt.hash(updateUserDto.password, 10);
    }

    // Prepare update data
    const { password, ...otherData } = updateUserDto;
    const updateData: Partial<UserEntity> & {
      role?: ERoleName;
      password?: string;
    } = {
      ...otherData,
      ...(hashedPassword && { password: hashedPassword }),
    };

    const updatedUser = await this.userRepository.updateUser(id, updateData);

    // Emit user.banned event if status changed to non-ACTIVE
    if (
      updateUserDto.status &&
      updateUserDto.status !== 'active' &&
      existingUser.status !== updateUserDto.status
    ) {
      await this.eventEmitter.emitAsync(
        USER_EVENTS.BANNED,
        new UserBannedEvent(id),
      );
    }

    return updatedUser;
  }

  async updateAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<UserEntity> {
    await this.findOne(userId);

    if (!this.supportedAvatarMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('Unsupported avatar file type');
    }

    const upload = await this.storageService.uploadUserAvatar({ userId, file });

    try {
      return await this.userRepository.updateAvatarUrl(userId, upload.url);
    } catch (error) {
      try {
        await this.storageService.deleteObject(upload.key);
      } catch (cleanupError) {
        this.logger.error(
          `[${this.context}] Failed to cleanup uploaded avatar after persistence failure`,
          {
            userId,
            key: upload.key,
            persistenceError:
              error instanceof Error ? error.message : String(error),
            cleanupError:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          },
          this.context,
        );
      }

      throw error;
    }
  }

  /**
   * Remove user
   */
  async remove(id: string): Promise<{ message: string }> {
    // Check if user exists
    await this.findOne(id);

    // Delete user
    await this.userRepository.deleteUser(id);

    return { message: `User ${id} deleted successfully` };
  }

  private async buildVerificationUrl(
    user: UserEntity,
    mode: EmailVerificationMode,
  ): Promise<string> {
    const signOptions = this.buildJwtSignOptions(
      config.JWT_SECRET_ACCESS_TOKEN,
      config.JWT_TOKEN_EXPIRATION_TIME,
    );
    const token = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        purpose: UserService.EMAIL_VERIFICATION_PURPOSE,
        mode,
      } satisfies EmailVerificationTokenPayload,
      signOptions,
    );

    const appHost = config.APP_HOST.replace(/\/+$/, '');
    return `${appHost}/api/v1/user/verify-email?token=${encodeURIComponent(token)}`;
  }

  private async createPendingVerificationUser(
    createUserDto: CreateUserDto & { role: ERoleName },
    passwordHash: string,
    verificationMode: EmailVerificationMode,
  ): Promise<UserEntity> {
    const existingUser = await this.userRepository.getUserByEmail(
      createUserDto.email,
    );
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const user = await this.userRepository.createUser({
      ...createUserDto,
      password: passwordHash,
      status: UserService.PENDING_VERIFICATION_STATUS,
    });

    const verificationUrl = await this.buildVerificationUrl(
      user,
      verificationMode,
    );
    const emailSent = await this.userEmailService.sendAccountVerificationEmail(
      {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
      },
      verificationUrl,
      {
        requiresPasswordSetup: verificationMode === 'setup_password',
      },
    );

    if (!emailSent) {
      await this.userRepository.deleteUser(user.id);
      throw new InternalServerErrorException(
        'Failed to send verification email',
      );
    }

    return user;
  }

  private async decodeVerificationToken(
    token: string,
  ): Promise<EmailVerificationTokenPayload> {
    if (!token?.trim()) {
      throw new BadRequestException('Verification token is required');
    }

    try {
      const payload =
        await this.jwtService.verifyAsync<EmailVerificationTokenPayload>(
          token,
          {
            secret: config.JWT_SECRET_ACCESS_TOKEN,
          },
        );

      if (payload.purpose !== UserService.EMAIL_VERIFICATION_PURPOSE) {
        throw new UnauthorizedException(
          'Verification token is invalid or expired',
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException(
        'Verification token is invalid or expired',
      );
    }
  }

  private generateTemporaryPassword(): string {
    return randomBytes(32).toString('hex');
  }

  private buildJwtSignOptions(secret: string, expiresIn: string): JwtSignOptions {
    return {
      secret,
      expiresIn: this.parseJwtExpiresIn(expiresIn),
    };
  }

  private parseJwtExpiresIn(expiresIn: string): JwtExpiresIn {
    return expiresIn as JwtExpiresIn;
  }
}
