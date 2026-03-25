import {
  // IsEmail,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { CreateUserDto } from '../../user/dto/user.dto';



/** ===================== LOGIN ===================== */
export class LoginDto {
  @ApiProperty({
    description: 'User email',
    example: 'admin1@example.com',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value) as string)
  @IsString() @IsNotEmpty()
  username!: string;

  @ApiProperty({
    description: 'User password',
    example: 'password123',
    minLength: 8,
    maxLength: 128
  })
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: 'User IP address',
    example: '192.168.1.1'
  })
  @IsString() @IsOptional()
  ip?: string

  /** Optional: lưu phiên dài ngày nếu cần */
  @ApiPropertyOptional({
    description: 'Remember user session for extended period',
    example: true,
    default: false
  })
  @IsOptional() @IsBoolean()
  rememberMe?: boolean;
}

/** ===================== REFRESH TOKEN ===================== */
export class RefreshTokenRequestDto {
  @ApiProperty({
    description: 'Refresh token for getting new access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsString() @IsNotEmpty()
  refreshToken!: string;

  @ApiPropertyOptional({
    description: 'User IP address',
    example: '192.168.1.1'
  })
  @IsOptional() 
  @IsString() 
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value) as string | undefined)
  ip?: string;
}
export class RefreshTokenDto {
  refreshToken: string
  ip?: string
  id: string
}
/** ===================== LOGOUT (revoke 1 session) ===================== */
export class LogoutDto {
  @ApiPropertyOptional({
    description: 'Refresh token to revoke (optional)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsOptional() @IsString()
  refreshToken?: string;
}

/** ===================== PUBLIC MEMBER REGISTER ===================== */
export class RegisterMemberDto extends OmitType(CreateUserDto, ['role'] as const) {
  @ApiProperty({
    description: 'Member email',
    example: 'member@example.com',
    format: 'email',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value) as string)
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Member password',
    example: 'SecurePass@123',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({
    description: 'Password confirmation',
    example: 'SecurePass@123',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  confirmPassword!: string;
}
