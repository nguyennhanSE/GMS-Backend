import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UserEntity } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto, UserFilterDto } from './dto/user.dto';
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

@Injectable()
export class UserService {
  private readonly context = UserService.name;
  private readonly supportedAvatarMimeTypes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);

  constructor(
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly storageService: StorageService,
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
    // Check if user already exists
    const existingUser = await this.userRepository.getUserByEmail(
      createUserDto.email,
    );
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const password = await bcrypt.hash(createUserDto.password, 10);

    return this.userRepository.createUser({
      ...createUserDto,
      password,
    });
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
}
