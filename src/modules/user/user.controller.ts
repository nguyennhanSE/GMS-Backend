import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto, GetUsersQueryDto, UpdateUserDto } from './dto/user.dto';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { toResponse } from './mapper/user.mapper';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { RolesService } from '../roles/roles.service';
import { AssignRolesToSingleUserDto } from '../roles/dto/roles.dto';
import { Request } from 'express';
import { TokenPayload } from 'src/libs/constants/interface';

@ApiTags('User Management')
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly rolesService: RolesService,
  ) {}

  @Post('create')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Create a new user with role assignment' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation error or user already exists',
  })
  async create(@Body() createUserDto: CreateUserDto) {
    const responseModel = new ResponseModel();

    try {
      const user = await this.userService.create(createUserDto);
      const result = toResponse(user);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get('list')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get paginated list of users' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async list(@Query() q: GetUsersQueryDto) {
    const responseModel = new ResponseModel();

    try {
      const {
        page,
        limit,
        sort,
        sortBy,
        counted,
        q: search,
        email,
        searchField,
        role,
      } = q;

      const pageNum = page
        ? typeof page === 'string'
          ? parseInt(page, 10)
          : page
        : 1;
      const limitNum = limit
        ? typeof limit === 'string'
          ? parseInt(limit, 10)
          : limit
        : 10;

      const data = await this.userService.getUserPaginate(
        {
          page: pageNum,
          limit: limitNum,
          sort: sort || 'asc',
          sortBy: sortBy || 'createdAt',
        },
        {
          q: search,
          email,
          searchField,
          role: role === 'ALL' ? undefined : role,
        },
        { counted: counted ?? true },
      );

      const docs = data.docs.map((e) => toResponse(e));

      const result = { ...data, docs };
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string) {
    const responseModel = new ResponseModel();

    try {
      const user = await this.userService.findOne(id);
      const result = toResponse(user);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Patch(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Update user information' })
  @ApiResponse({ status: 200, description: 'User updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    const responseModel = new ResponseModel();

    try {
      const user = await this.userService.update(id, updateUserDto);
      const result = toResponse(user);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Delete(':id')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Delete user' })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(@Param('id') id: string) {
    const responseModel = new ResponseModel();

    try {
      const result = await this.userService.remove(id);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }

    return responseModel;
  }

  @Get(':userId/roles')
  @ApiOperation({ summary: 'Get user roles' })
  @ApiResponse({
    status: 200,
    description: 'User roles retrieved successfully',
  })
  async getUserRoles(
    @Param('userId') userId: string,
    @Req() req: Request & { user?: TokenPayload },
  ) {
    const responseModel = new ResponseModel();
    try {
      // Allow users to view their own roles
      const requestingUser = req.user;
      if (
        requestingUser?.sub !== userId &&
        !requestingUser?.roles?.includes(ERoleName.ADMIN)
      ) {
        throw new ForbiddenException('Cannot view other users roles');
      }

      const roles = await this.rolesService.getUserRoles(userId);
      const user = await this.userService.findOne(userId);

      responseModel.setData({
        userId,
        userName: `${user.firstName} ${user.lastName}`.trim(),
        roles: roles.map((name) => ({ name })),
      });
    } catch (error) {
      throw error;
    }
    return responseModel;
  }

  @Post(':userId/roles')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Assign roles to user' })
  @ApiResponse({ status: 200, description: 'Roles assigned successfully' })
  async assignRolesToUser(
    @Param('userId') userId: string,
    @Body() assignDto: AssignRolesToSingleUserDto,
  ) {
    const responseModel = new ResponseModel();
    try {
      // Verify user exists
      await this.userService.findOne(userId);

      // Assign each role
      const results: any[] = [];
      for (const roleId of assignDto.roleIds) {
        const result = await this.rolesService.assignRoleToUsers(roleId, {
          userIds: [userId],
        });
        results.push(result);
      }

      responseModel.setData({
        userId,
        assignedRoles: assignDto.roleIds.length,
        results,
      });
    } catch (error) {
      throw error;
    }
    return responseModel;
  }

  @Delete(':userId/roles/:roleId')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Remove role from user' })
  @ApiResponse({ status: 200, description: 'Role removed successfully' })
  async removeRoleFromUser(
    @Param('userId') userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    const responseModel = new ResponseModel();
    try {
      const result = await this.rolesService.revokeRoleFromUser(roleId, userId);
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }
    return responseModel;
  }

  @Get('by-role/:roleId')
  @Roles(ERoleName.ADMIN)
  @ApiOperation({ summary: 'Get users by role' })
  @ApiResponse({ status: 200, description: 'Users retrieved successfully' })
  async getUsersByRole(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const responseModel = new ResponseModel();
    try {
      const result = await this.rolesService.getUsersByRole(
        roleId,
        page ? Number(page) : 1,
        limit ? Number(limit) : 20,
        search,
      );
      responseModel.setData(result);
    } catch (error) {
      throw error;
    }
    return responseModel;
  }
}
