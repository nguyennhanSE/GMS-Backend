import { CreateUserDto } from 'src/modules/user/dto/user.dto';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from 'src/utils/helper';

export class CreateTrainerDto extends OmitType(CreateUserDto, ['role'] as const) {
  @ApiProperty({
    description: 'Initial trainer password',
    example: 'SecurePass@123',
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: 'Initial trainer account status',
    example: 'active',
  })
  @IsOptional()
  @IsString()
  @trim()
  status?: string;
}
