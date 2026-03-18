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

@Injectable()
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly eventEmitter: EventEmitter2,
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
