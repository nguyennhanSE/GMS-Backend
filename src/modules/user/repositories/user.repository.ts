import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { UserEntity } from '../entities/user.entity';
import { CreateUserDto, UserFilterDto } from '../dto/user.dto';
import {
  toPrismaUserCreateInput,
  toUserEntityWithRelations,
} from '../mapper/user.mapper';
import {
  IPaginate,
  PaginateOptions,
} from '../../../libs/models/paginate/pagimate.model';
import { Prisma } from '@prisma/client';
import { ERoleName } from '../../roles/enums/role.enum';
import { AppLogger } from '../../../libs/logger';

@Injectable()
export class UserRepository {
  private readonly context = UserRepository.name;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Get user by account (id) with relations
   */
  async getUserByAccount(account: string): Promise<UserEntity | null> {
    // Validate account is not empty or undefined
    if (!account || account.trim() === '') {
      return null;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: account.trim() },
        include: {
          userRole: {
            include: {
              role: true,
            },
          },
          userMembership: {
            include: {
              membership: true,
            },
          },
        },
      });
      if (!user) {
        return null;
      }
      const userEntity = toUserEntityWithRelations(user);
      return userEntity;
    } catch (error) {
      this.logger.error(
        `[${this.context}] Failed to fetch user by account`,
        { account: account.trim() },
        this.context,
      );
      throw error;
    }
  }

  /**
   * Get user by email with relations
   */
  async getUserByEmail(email: string): Promise<UserEntity | null> {
    const user = await this.prisma.user.findFirst({
      where: { email },
      include: {
        userRole: {
          include: {
            role: true,
          },
        },
        userMembership: {
          include: {
            membership: true,
          },
        },
      },
    });
    if (!user) {
      return null;
    }
    return toUserEntityWithRelations(user);
  }

  /**
   * Create a new user
   */
  async createUser(
    createUserDto: CreateUserDto & { password: string; status?: string | null },
  ): Promise<UserEntity> {
    const roleName = createUserDto.role ?? ERoleName.MEMBER;

    const role = await this.prisma.role.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      throw new BadRequestException(`Role ${roleName} not found in database`);
    }

    // Create user and assign role in a transaction
    const createdUserId = await this.prisma.$transaction(async (tx) => {
      // Create the user
      const createdUser = await tx.user.create({
        data: toPrismaUserCreateInput(createUserDto),
      });

      // Assign role to user
      await tx.userRole.create({
        data: {
          userId: createdUser.id,
          roleId: role.id,
        },
      });

      return createdUser.id;
    });

    // Fetch the created user with all relations
    const userWithRelations = await this.prisma.user.findUnique({
      where: { id: createdUserId },
      include: {
        userRole: {
          include: {
            role: true,
          },
        },
        userMembership: {
          include: {
            membership: true,
          },
        },
      },
    });

    if (!userWithRelations) {
      throw new BadRequestException('Failed to retrieve created user');
    }

    return toUserEntityWithRelations(userWithRelations);
  }

  /**
   * Update user
   */
  async updateUser(
    userId: string,
    updateData: Partial<UserEntity> & { role?: ERoleName; password?: string },
  ): Promise<UserEntity> {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new BadRequestException(`User with id ${userId} not found`);
    }

    // Extract role from update data (handle it separately)
    const { role, ...userData } = updateData;

    // Update user and role in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Update user fields
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: userData.firstName,
          lastName: userData.lastName,
          email: userData.email,
          password: userData.password ?? undefined,
          phone: userData.phone ?? undefined,
          gender: userData.gender ?? undefined,
          dob: userData.dob ?? undefined,
          address: userData.address ?? undefined,
          status: userData.status ?? undefined,
        },
      });

      // Update role if provided
      if (role) {
        // Find the new role
        const newRole = await tx.role.findUnique({
          where: { name: role },
        });

        if (!newRole) {
          throw new BadRequestException(`Role ${role} not found in database`);
        }

        // Delete existing user roles
        await tx.userRole.deleteMany({
          where: { userId },
        });

        // Assign new role
        await tx.userRole.create({
          data: {
            userId,
            roleId: newRole.id,
          },
        });
      }
    });

    // Fetch the updated user with all relations
    const userWithRelations = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRole: {
          include: {
            role: true,
          },
        },
        userMembership: {
          include: {
            membership: true,
          },
        },
      },
    });

    if (!userWithRelations) {
      throw new BadRequestException('Failed to retrieve updated user');
    }

    return toUserEntityWithRelations(userWithRelations);
  }

  async updateAvatarUrl(
    userId: string,
    avatarUrl: string | null,
  ): Promise<UserEntity> {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new BadRequestException(`User with id ${userId} not found`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl,
      },
      include: {
        userRole: {
          include: {
            role: true,
          },
        },
        userMembership: {
          include: {
            membership: true,
          },
        },
      },
    });

    return toUserEntityWithRelations(updatedUser);
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new BadRequestException(`User with id ${userId} not found`);
    }

    // Delete user (cascade will handle userRole deletion)
    await this.prisma.user.delete({
      where: { id: userId },
    });
  }

  async getUserPaginate(
    filter: UserFilterDto,
    options: PaginateOptions,
  ): Promise<IPaginate<UserEntity>> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const sort = options.sort || 'asc';
    const sortBy = options.sortBy || 'createdAt';
    const counted = options.counted ?? true;

    const { q: search, email, searchField, role } = filter;

    // Build where clause
    const where: Prisma.UserWhereInput = {};

    // Filter by role
    if (role && role !== 'ALL') {
      where.userRole = {
        some: {
          role: {
            name: role,
          },
        },
      };
    }

    if (email) {
      where.email = email;
    }

    if (search) {
      this.logger.debug(
        `[${this.context}] Searching users`,
        { search, searchField: searchField || 'none' },
        this.context,
      );
      if (searchField) {
        // Search in specific field (only allow known string fields)
        if (searchField === 'firstName') {
          where.firstName = { contains: search, mode: 'insensitive' };
        } else if (searchField === 'lastName') {
          where.lastName = { contains: search, mode: 'insensitive' };
        } else if (searchField === 'email') {
          where.email = { contains: search, mode: 'insensitive' };
        } else if (searchField === 'phone') {
          where.phone = { contains: search, mode: 'insensitive' };
        } else if (searchField === 'status') {
          where.status = { contains: search, mode: 'insensitive' };
        }
      } else {
        // Search in firstName/lastName/email by default
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }
      this.logger.debug(
        `[${this.context}] User search where clause`,
        JSON.stringify(where),
        this.context,
      );
    }

    // Build orderBy
    const allowedSortFields = [
      'id',
      'firstName',
      'lastName',
      'email',
      'createdAt',
    ];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    // Map sort field to Prisma orderBy
    let orderBy: Prisma.UserOrderByWithRelationInput;
    if (sortField === 'id') {
      orderBy = { id: sort };
    } else if (sortField === 'firstName') {
      orderBy = { firstName: sort };
    } else if (sortField === 'lastName') {
      orderBy = { lastName: sort };
    } else if (sortField === 'email') {
      orderBy = { email: sort };
    } else if (sortField === 'createdAt') {
      orderBy = { createdAt: sort };
    } else {
      orderBy = { createdAt: sort };
    }

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute queries with relations
    this.logger.debug(
      `[${this.context}] Fetching paginated users`,
      { skip, limit, orderBy },
      this.context,
    );
    const [docs, totalDocs] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          userRole: {
            include: {
              role: true,
            },
          },
          userMembership: {
            include: {
              membership: true,
            },
          },
        },
      }),
      counted ? this.prisma.user.count({ where }) : Promise.resolve(0),
    ]);

    // Map to entities with relations
    const mappedDocs = docs.map(toUserEntityWithRelations);

    // Calculate pagination metadata
    const totalPages = counted ? Math.ceil(totalDocs / limit) : 0;
    const currentPage = page;
    const nextPage = currentPage < totalPages ? currentPage + 1 : null;
    const previousPage = currentPage > 1 ? currentPage - 1 : null;
    const hasNext = nextPage !== null;
    const hasPrev = previousPage !== null;

    if (counted) {
      return {
        docs: mappedDocs,
        docsCount: mappedDocs.length,
        totalDocs,
        totalPages,
        currentPage,
        nextPage,
        previousPage,
        limit,
        hasNext,
        hasPrev,
      };
    } else {
      return {
        docs: mappedDocs,
        currentPage,
        nextPage,
        previousPage,
        limit,
        hasNext,
        hasPrev,
      };
    }
  }
}
