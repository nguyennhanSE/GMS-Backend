import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsIn,
  IsBoolean,
  IsUUID,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

export class GetClassSchedulesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: '1',
    default: '1',
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: '10',
    default: '10',
  })
  @IsOptional()
  @IsString()
  limit?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    example: 'asc',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Whether to include total count',
    example: true,
    default: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  counted?: boolean;

  @ApiPropertyOptional({
    description: 'Search query text',
    example: 'yoga',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Specific field to search in (location, className)',
    example: 'className',
  })
  @IsOptional()
  @IsString()
  searchField?: string;

  @ApiPropertyOptional({
    description: 'Filter by day of week',
    example: 'MON',
    enum: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  })
  @IsOptional()
  @IsString()
  dayOfWeek?: DayOfWeek;

  @ApiPropertyOptional({
    description: 'Filter by trainer ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  trainerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by gym class ID (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({
    description: 'Filter by active status',
    example: true,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Date to check availability for (YYYY-MM-DD). Defaults to next occurrence of each schedule.',
    example: '2026-02-03',
  })
  @IsOptional()
  @IsString()
  date?: string;
}
