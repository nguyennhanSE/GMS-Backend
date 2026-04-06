import { CreateUserDto } from 'src/modules/user/dto/user.dto';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Trainer PT price for 30-minute sessions',
    example: 150000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  ptSessionPrice30?: number;

  @ApiPropertyOptional({
    description: 'Trainer PT price for 60-minute sessions',
    example: 250000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  ptSessionPrice60?: number;

  @ApiPropertyOptional({
    description: 'Trainer PT price for 90-minute sessions',
    example: 350000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  ptSessionPrice90?: number;

  @ApiPropertyOptional({
    description: 'Primary trainer specialization shown in trainer booking discovery',
    example: 'Strength & Conditioning',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @trim()
  specialization?: string;

  @ApiPropertyOptional({
    description: 'Years of trainer experience',
    example: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  experienceYears?: number;

  @ApiPropertyOptional({
    description: 'Trainer biography shown on the booking profile',
    example: 'Certified coach focused on strength, mobility, and sustainable progress.',
  })
  @IsOptional()
  @IsString()
  @trim()
  biography?: string;

  @ApiPropertyOptional({
    description: 'Trainer certifications',
    example: ['NASM CPT', 'Precision Nutrition Level 1'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  certifications?: string[];

  @ApiPropertyOptional({
    description: 'Trainer areas of expertise',
    example: ['Hypertrophy', 'Fat Loss', 'Mobility'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  areasOfExpertise?: string[];
}
