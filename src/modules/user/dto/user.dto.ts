import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trim, toLower } from 'src/utils/helper';
import { ERoleName } from '../../roles/enums/role.enum';

const AllowedRoles = Object.values(ERoleName) as ERoleName[];
const AllowedRoleMessage = `Role must be one of: ${AllowedRoles.join(', ')}`;

// Role filter options including 'ALL' for filtering by any role
const RoleFilterOptions = [...Object.values(ERoleName), 'ALL'] as const;
type RoleFilterType = ERoleName | 'ALL';

export class CreateUserDto {
  @ApiProperty({
    description: 'User first name',
    example: 'John',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @trim()
  @MaxLength(255)
  firstName!: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @trim()
  @MaxLength(255)
  lastName!: string;

  @ApiProperty({
    description: 'User email address',
    example: 'john.doe@gmail.com',
    format: 'email',
  })
  @IsEmail()
  @toLower()
  @trim()
  email!: string;

  @ApiPropertyOptional({
    description: 'User role (defaults to MEMBER if not provided)',
    example: ERoleName.MEMBER,
    enum: ERoleName,
  })
  @IsOptional()
  @IsEnum(ERoleName, { message: AllowedRoleMessage })
  role?: ERoleName;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '010-1234-5678',
  })
  @IsOptional()
  @IsString()
  @trim()
  phone?: string;

  @ApiPropertyOptional({
    description: 'Gender',
    example: 'male',
  })
  @IsOptional()
  @IsString()
  @trim()
  gender?: string;

  @ApiPropertyOptional({
    description: 'Date of birth',
    example: '1995-01-01',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dob?: Date;

  @ApiPropertyOptional({
    description: 'Address',
    example: '123 Main St',
  })
  @IsOptional()
  @IsString()
  address?: string;

}
export class CreateUser extends CreateUserDto {}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Signed email verification token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiPropertyOptional({
    description:
      'New password chosen during account activation when the verification flow requires password setup',
    example: 'SecurePass@123',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({
    description:
      'Confirmation of the new password when the verification flow requires password setup',
    example: 'SecurePass@123',
    minLength: 8,
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'User first name', example: 'John' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @trim()
  @MaxLength(255)
  firstName?: string;

  @ApiPropertyOptional({ description: 'User last name', example: 'Doe' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @trim()
  @MaxLength(255)
  lastName?: string;

  @ApiPropertyOptional({
    description: 'User email address',
    example: 'john.doe@gmail.com',
  })
  @IsOptional()
  @IsEmail()
  @trim()
  email?: string;

  @ApiPropertyOptional({
    description: 'Phone number',
    example: '010-1234-5678',
  })
  @IsOptional()
  @IsString()
  @trim()
  phone?: string;

  @ApiPropertyOptional({ description: 'Gender', example: 'male' })
  @IsOptional()
  @IsString()
  @trim()
  gender?: string;

  @ApiPropertyOptional({ description: 'Date of birth', example: '1995-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dob?: Date;

  @ApiPropertyOptional({ description: 'Address', example: '123 Main St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'Status', example: 'active' })
  @IsOptional()
  @IsString()
  @trim()
  status?: string;

  @ApiPropertyOptional({ description: 'User role', enum: ERoleName })
  @IsOptional()
  @IsEnum(ERoleName, { message: AllowedRoleMessage })
  role?: ERoleName;

  @ApiPropertyOptional({
    description: 'New password (will be hashed)',
    example: 'newPassword123',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

export class UpdatePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string; // new password to set
}

export class UserFilterDto {
  @ApiPropertyOptional({
    description: 'Search query string',
    example: 'john',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Specific field to search in',
    example: 'firstName',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @trim()
  @MaxLength(100)
  searchField?: string;

  @ApiPropertyOptional({
    description: 'Filter by email address',
    example: 'john.doe@gmail.com',
  })
  @IsOptional()
  @IsEmail()
  @toLower()
  @trim()
  email?: string;

  @ApiPropertyOptional({
    description: 'Filter by role',
    example: 'ADMIN',
    enum: RoleFilterOptions,
  })
  @IsOptional()
  @IsEnum(RoleFilterOptions, { message: `${AllowedRoleMessage}, ALL` })
  role?: RoleFilterType;
}

export class GetUsersQueryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination (starts at 1)',
    example: '1',
    type: String,
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: '10',
    type: String,
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'asc',
    enum: ['asc', 'desc'],
  })
  @IsOptional()
  @IsString()
  sort?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    type: String,
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Whether to include total count in response',
    example: true,
    type: Boolean,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  counted?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by role',
    example: 'ADMIN',
    enum: RoleFilterOptions,
  })
  @IsOptional()
  @IsEnum(RoleFilterOptions, { message: `${AllowedRoleMessage}, ALL` })
  role?: RoleFilterType;

  @ApiPropertyOptional({
    description:
      'Search query string (searches in firstName/lastName/email by default)',
    example: 'john',
    type: String,
  })
  @IsOptional()
  @IsString()
  @trim()
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter by specific email address',
    example: 'john.doe@gmail.com',
    type: String,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description:
      'Specific field to search in (e.g., "firstName", "lastName", "email"). If provided, search query will only search in this field',
    example: 'firstName',
    type: String,
  })
  @IsOptional()
  @IsString()
  @trim()
  searchField?: string;
}
