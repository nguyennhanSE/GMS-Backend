import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  Req,
  ForbiddenException,
  Header,
  ParseFilePipeBuilder,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UserService } from './user.service';
import {
  CreateUserDto,
  GetUsersQueryDto,
  UpdateUserDto,
  VerifyEmailDto,
} from './dto/user.dto';
import { Roles } from '../../libs/decorator/roles.decorator';
import { ERoleName } from '../roles/enums/role.enum';
import { toResponse } from './mapper/user.mapper';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiConsumes,
  ApiQuery,
} from '@nestjs/swagger';
import { ResponseModel } from '../../libs/models/response/response.model';
import { RolesService } from '../roles/roles.service';
import { AssignRolesToSingleUserDto } from '../roles/dto/roles.dto';
import type { Request } from 'express';
import { TokenPayload } from 'src/libs/constants/interface';
import { CurrentUser } from '../../libs/decorator/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../../libs/decorator/public.decorator';

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
  @ApiOperation({
    summary: 'Create a new user and send a verification link for password setup',
  })
  @ApiResponse({
    status: 201,
    description:
      'User created successfully in pending_verification status and password-setup verification email sent',
  })
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

  @Get('verify-email')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @ApiOperation({ summary: 'Verify a newly created user email address' })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Signed email verification token',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification landing page returned successfully',
  })
  async verifyEmailLanding(@Query('token') token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('Verification token is required');
    }

    const escapedToken = escapeHtmlAttribute(token);
    const verificationContext =
      await this.userService.getVerificationContext(token);
    const passwordFields = verificationContext.requiresPasswordSetup
      ? `
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" minlength="8" maxlength="128" required>
            </div>
            <div class="field">
              <label for="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" minlength="8" maxlength="128" required>
            </div>
        `
      : '';
    const actionCopy = verificationContext.requiresPasswordSetup
      ? 'To activate your account, set your password and confirm the request below.'
      : 'To activate your account, confirm the verification request below.';
    const submitLabel = verificationContext.requiresPasswordSetup
      ? 'Set Password and Activate Account'
      : 'Activate Account';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Verify Your Liflow Account</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; padding: 24px; background-color: #f6f7fb; }
          .card { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
          .button { display: inline-block; border: 0; background: #1f7a3d; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 16px; cursor: pointer; }
          .field { margin: 0 0 16px; }
          label { display: block; margin: 0 0 8px; font-weight: 600; }
          input[type="password"] { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 16px; }
          p { margin: 0 0 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Verify Your Liflow Account</h1>
          <p>Your verification link has been opened. ${actionCopy}</p>
          <p>This extra confirmation prevents email scanners and browser prefetchers from activating the account automatically.</p>
          <form method="post" action="/user/verify-email">
            <input type="hidden" name="token" value="${escapedToken}">
            ${passwordFields}
            <button class="button" type="submit">${submitLabel}</button>
          </form>
        </div>
      </body>
      </html>
    `;
  }

  @Post('verify-email')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Activate a verified user, optionally setting the initial password when the verification flow requires it',
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: 200,
    description: 'User email verified successfully',
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    const responseModel = new ResponseModel();

    try {
      const user = await this.userService.verifyEmail(verifyEmailDto);
      responseModel.setData(toResponse(user));
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

  @Patch('avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload avatar for the current authenticated user' })
  @ApiResponse({ status: 200, description: 'Avatar updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file upload request' })
  async updateAvatar(
    @CurrentUser('sub') userId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({
          maxSize: 5 * 1024 * 1024,
        })
        .build({
          fileIsRequired: true,
          errorHttpStatusCode: 400,
        }),
    )
    file: Express.Multer.File,
  ) {
    const responseModel = new ResponseModel();

    try {
      const user = await this.userService.updateAvatar(userId, file);
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

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
